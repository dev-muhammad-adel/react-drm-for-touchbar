#!/usr/bin/env python3
"""
Standalone panel window for the react-drm browser preview, docked to the
bottom of the screen with reserved space via the Wayland layer-shell
protocol — the same mechanism waybar itself uses. Requires a layer-shell
compositor (niri, Sway, Hyprland, River, ...); does not apply to GNOME/KDE
or X11-only setups.

This connects directly to src/dev/preview-server.ts's WebSocket endpoint —
the exact same wire protocol preview-page.html speaks — and paints the
received RGBA frames onto a plain GTK Image. No browser engine involved:
the native Cairo framebuffer's bytes go straight from the WebSocket to a
GdkPixbuf, the smallest possible path onto the screen.

The WebSocket client below is hand-rolled (RFC 6455) rather than using
libsoup's client: Soup.Session.websocket_connect_async reliably completed
the handshake against this exact server (confirmed via server-side logs —
upgrade succeeds, then the client tears down the raw socket within ~1s,
code 1006/no close frame) but never delivered a single message, across
several combinations of call arguments. Rather than debug further into the
PyGObject/libsoup3 binding, talking raw sockets removes that dependency
entirely and is little code for the narrow subset of WebSocket we need
(client-initiated, binary frames in, small JSON text frames out).
"""
import base64
import hashlib
import json
import math
import os
import socket
import struct
from urllib.parse import urlparse

import gi

gi.require_version('Gdk', '3.0')
gi.require_version('GdkPixbuf', '2.0')
gi.require_version('Gtk', '3.0')
gi.require_version('GtkLayerShell', '0.1')
from gi.repository import GdkPixbuf, Gdk, GLib, Gtk, GtkLayerShell  # noqa: E402

PREVIEW_URL = os.environ.get('REACT_DRM_PREVIEW_URL', 'http://127.0.0.1:8787')
WS_URL = PREVIEW_URL.replace('http://', 'ws://').replace('https://', 'wss://') + '/ws'
TOUCHBAR_ASPECT = 2008 / 60  # logical Touch Bar width:height — matches DEFAULT_DISPLAY_W/H
RECONNECT_DELAY_S = 1

# Wire protocol (matches preview-server.ts / preview-page.html exactly): every
# binary WS message is a 16-byte header — width, height, stride, format as
# uint32 LE — followed by raw pixel bytes. Format 1 = RGBA8888, already
# converted from Cairo's native byte order on the native side.
HEADER_FORMAT = '<4I'
HEADER_BYTES = struct.calcsize(HEADER_FORMAT)
FORMAT_RGBA8888 = 1

WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
OP_TEXT, OP_BINARY, OP_CLOSE, OP_PING, OP_PONG = 0x1, 0x2, 0x8, 0x9, 0xA


class WSClient:
    """Minimal RFC 6455 client: connects, then hands complete frame payloads
    to on_message via a non-blocking socket integrated with the GLib main
    loop (GLib.io_add_watch) — no threads."""

    def __init__(self, url: str, on_message, on_close):
        self.url = url
        self.on_message = on_message
        self.on_close = on_close
        self.sock: socket.socket | None = None
        self.buf = b''
        self.connected = False
        self.watch_id: int | None = None

    def connect(self) -> None:
        parsed = urlparse(self.url)
        host, port = parsed.hostname, parsed.port or 80
        path = parsed.path or '/'
        try:
            self.sock = socket.create_connection((host, port), timeout=3)
        except OSError as e:
            self._fail(f'connect: {e}')
            return

        key = base64.b64encode(os.urandom(16)).decode()
        request = (
            f'GET {path} HTTP/1.1\r\n'
            f'Host: {host}:{port}\r\n'
            'Upgrade: websocket\r\n'
            'Connection: Upgrade\r\n'
            f'Sec-WebSocket-Key: {key}\r\n'
            'Sec-WebSocket-Version: 13\r\n'
            '\r\n'
        )
        try:
            self.sock.sendall(request.encode())
            resp = b''
            while b'\r\n\r\n' not in resp:
                chunk = self.sock.recv(4096)
                if not chunk:
                    self._fail('connection closed during handshake')
                    return
                resp += chunk
        except OSError as e:
            self._fail(f'handshake: {e}')
            return

        header, _, rest = resp.partition(b'\r\n\r\n')
        status_line = header.split(b'\r\n', 1)[0]
        if b' 101 ' not in (b' ' + status_line):
            self._fail(f'bad handshake status: {status_line!r}')
            return
        expected = base64.b64encode(hashlib.sha1((key + WS_MAGIC).encode()).digest())
        if expected not in header:
            self._fail('Sec-WebSocket-Accept mismatch')
            return

        self.buf = rest
        self.connected = True
        self.sock.setblocking(False)
        self.watch_id = GLib.io_add_watch(
            self.sock.fileno(), GLib.IO_IN | GLib.IO_HUP | GLib.IO_ERR, self._on_readable,
        )
        self._process_buffer()

    def _fail(self, reason: str) -> None:
        print(f'[gtk-preview] {reason}', flush=True)
        self._teardown()
        self.on_close()

    def _on_readable(self, _sock, condition) -> bool:
        if condition & (GLib.IO_HUP | GLib.IO_ERR):
            self._teardown()
            self.on_close()
            return False
        try:
            chunk = self.sock.recv(1 << 20)
        except BlockingIOError:
            return True
        except OSError:
            self._teardown()
            self.on_close()
            return False
        if not chunk:
            self._teardown()
            self.on_close()
            return False
        self.buf += chunk
        self._process_buffer()
        return True

    def _process_buffer(self) -> None:
        while True:
            frame = self._take_frame()
            if frame is None:
                return
            opcode, payload = frame
            if opcode == OP_CLOSE:
                self._teardown()
                self.on_close()
                return
            elif opcode == OP_BINARY:
                self.on_message(payload)
            elif opcode == OP_PING:
                self._send_frame(OP_PONG, payload)

    def _take_frame(self):
        buf = self.buf
        if len(buf) < 2:
            return None
        b0, b1 = buf[0], buf[1]
        opcode = b0 & 0x0F
        masked = (b1 & 0x80) != 0
        length = b1 & 0x7F
        offset = 2
        if length == 126:
            if len(buf) < offset + 2:
                return None
            length = struct.unpack_from('>H', buf, offset)[0]
            offset += 2
        elif length == 127:
            if len(buf) < offset + 8:
                return None
            length = struct.unpack_from('>Q', buf, offset)[0]
            offset += 8
        mask_key = b''
        if masked:
            if len(buf) < offset + 4:
                return None
            mask_key = buf[offset:offset + 4]
            offset += 4
        if len(buf) < offset + length:
            return None
        payload = buf[offset:offset + length]
        if masked:
            payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
        self.buf = buf[offset + length:]
        return opcode, payload

    def send_text(self, text: str) -> None:
        self._send_frame(OP_TEXT, text.encode())

    def _send_frame(self, opcode: int, payload: bytes) -> None:
        if not self.connected or not self.sock:
            return
        mask_key = os.urandom(4)
        masked = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
        length = len(payload)
        b0 = 0x80 | opcode  # FIN=1
        if length < 126:
            header = struct.pack('!BB', b0, 0x80 | length)
        elif length < 65536:
            header = struct.pack('!BBH', b0, 0x80 | 126, length)
        else:
            header = struct.pack('!BBQ', b0, 0x80 | 127, length)
        try:
            self.sock.sendall(header + mask_key + masked)
        except OSError:
            self._teardown()
            self.on_close()

    def _teardown(self) -> None:
        if self.watch_id is not None:
            GLib.source_remove(self.watch_id)
            self.watch_id = None
        if self.sock:
            try:
                self.sock.close()
            except OSError:
                pass
            self.sock = None
        self.connected = False


SIDE_MARGIN_PX = 10  # inset from the left/right screen edges
CORNER_RADIUS_PX = 10  # rounds the panel's corners; desktop shows through the cut


def monitor_width() -> int:
    monitor = Gdk.Display.get_default().get_monitor(0)
    return monitor.get_geometry().width


def rounded_rect_path(cr, x: float, y: float, w: float, h: float, r: float) -> None:
    cr.new_sub_path()
    cr.arc(x + w - r, y + r, r, -math.pi / 2, 0)
    cr.arc(x + w - r, y + h - r, r, 0, math.pi / 2)
    cr.arc(x + r, y + h - r, r, math.pi / 2, math.pi)
    cr.arc(x + r, y + r, r, math.pi, 3 * math.pi / 2)
    cr.close_path()


class PreviewPanel:
    def __init__(self):
        self.target_width = monitor_width() - 2 * SIDE_MARGIN_PX
        self.target_height = round(self.target_width / TOUCHBAR_ASPECT)
        # Native (logical Touch Bar) size of the most recently received frame —
        # used to convert widget-local input coordinates back to logical
        # pixels. Defaults match DEFAULT_DISPLAY_W/H until the first frame.
        self.native_width = 2008
        self.native_height = 60
        self.pressed = False

        self.window = Gtk.Window()
        rgba_visual = self.window.get_screen().get_rgba_visual()
        if rgba_visual is not None:
            self.window.set_visual(rgba_visual)
        css_provider = Gtk.CssProvider()
        css_provider.load_from_data(b'window, eventbox { background-color: transparent; }')
        Gtk.StyleContext.add_provider_for_screen(
            self.window.get_screen(), css_provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
        )
        GtkLayerShell.init_for_window(self.window)
        GtkLayerShell.set_layer(self.window, GtkLayerShell.Layer.TOP)
        GtkLayerShell.set_anchor(self.window, GtkLayerShell.Edge.BOTTOM, True)
        GtkLayerShell.set_anchor(self.window, GtkLayerShell.Edge.LEFT, True)
        GtkLayerShell.set_anchor(self.window, GtkLayerShell.Edge.RIGHT, True)
        GtkLayerShell.set_margin(self.window, GtkLayerShell.Edge.LEFT, SIDE_MARGIN_PX)
        GtkLayerShell.set_margin(self.window, GtkLayerShell.Edge.RIGHT, SIDE_MARGIN_PX)
        # Reserves real screen space — other windows won't overlap this strip.
        GtkLayerShell.set_exclusive_zone(self.window, self.target_height)
        self.window.set_default_size(self.target_width, self.target_height)

        self.image = Gtk.Image()
        self.event_box = Gtk.EventBox()
        self.event_box.add(self.image)
        self.event_box.add_events(
            Gdk.EventMask.BUTTON_PRESS_MASK
            | Gdk.EventMask.BUTTON_RELEASE_MASK
            | Gdk.EventMask.POINTER_MOTION_MASK
        )
        self.event_box.connect('button-press-event', self.on_button_press)
        self.event_box.connect('button-release-event', self.on_button_release)
        self.event_box.connect('motion-notify-event', self.on_motion)
        self.event_box.connect('draw', self.on_event_box_draw)
        self.window.add(self.event_box)

        self.window.connect('key-press-event', self.on_key_press)
        self.window.connect('destroy', Gtk.main_quit)

        self.ws = WSClient(WS_URL, self.on_ws_message, self.on_ws_closed)
        self.ws.connect()

    def on_event_box_draw(self, widget, cr) -> bool:
        # Clips the whole draw pass (including the child Gtk.Image) to a
        # rounded rect; GTK3 reuses this same cairo context when it
        # propagates the draw signal to children, so returning False here
        # lets the image paint through the clip we just set.
        alloc = widget.get_allocation()
        rounded_rect_path(cr, 0, 0, alloc.width, alloc.height, CORNER_RADIUS_PX)
        cr.clip()
        return False

    def on_ws_closed(self) -> None:
        print(f'[gtk-preview] disconnected, retrying in {RECONNECT_DELAY_S}s', flush=True)
        GLib.timeout_add_seconds(RECONNECT_DELAY_S, self._reconnect)

    def _reconnect(self) -> bool:
        self.ws = WSClient(WS_URL, self.on_ws_message, self.on_ws_closed)
        self.ws.connect()
        return False  # one-shot timer

    def on_ws_message(self, data: bytes) -> None:
        if len(data) < HEADER_BYTES:
            return
        width, height, stride, fmt = struct.unpack_from(HEADER_FORMAT, data, 0)
        if fmt != FORMAT_RGBA8888:
            return
        self.native_width, self.native_height = width, height

        pixels = data[HEADER_BYTES:]
        pixbuf = GdkPixbuf.Pixbuf.new_from_bytes(
            GLib.Bytes.new(pixels), GdkPixbuf.Colorspace.RGB,
            True, 8, width, height, stride,
        )
        if (width, height) != (self.target_width, self.target_height):
            pixbuf = pixbuf.scale_simple(
                self.target_width, self.target_height, GdkPixbuf.InterpType.NEAREST,
            )
        self.image.set_from_pixbuf(pixbuf)

    # ── Input: widget-local px → logical Touch Bar px → WebSocket ────────────

    def to_logical(self, x: float, y: float) -> tuple[int, int]:
        alloc = self.event_box.get_allocation()
        w = max(1, alloc.width)
        h = max(1, alloc.height)
        lx = round(x * (self.native_width / w))
        ly = round(y * (self.native_height / h))
        return (
            max(0, min(self.native_width - 1, lx)),
            max(0, min(self.native_height - 1, ly)),
        )

    def send_touch(self, kind: str, x: float, y: float) -> None:
        if not self.ws.connected:
            return
        lx, ly = self.to_logical(x, y)
        self.ws.send_text(json.dumps({'type': kind, 'x': lx, 'y': ly}))

    def on_button_press(self, _widget, event) -> None:
        self.pressed = True
        self.send_touch('touchstart', event.x, event.y)

    def on_motion(self, _widget, event) -> None:
        if self.pressed:
            self.send_touch('touchmove', event.x, event.y)

    def on_button_release(self, _widget, event) -> None:
        if self.pressed:
            self.pressed = False
            self.send_touch('touchend', event.x, event.y)

    def on_key_press(self, _widget, event) -> None:
        if Gdk.keyval_name(event.keyval) == 'Escape':
            Gtk.main_quit()

    def show(self) -> None:
        self.window.show_all()


def main() -> None:
    panel = PreviewPanel()
    panel.show()
    Gtk.main()


if __name__ == '__main__':
    main()
