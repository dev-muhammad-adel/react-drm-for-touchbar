# react-drm

react-drm provides a React renderer for drawing directly to Linux DRM/KMS
displays using libdrm and Cairo. This repository includes a control center
that replaces the standard Touch Bar interface on T2 MacBooks running Linux.
This copy is integrated with KaiT2en and is installed through the KaiT2en
application installer.

The control center provides:

- Function keys and an optional on-screen Escape key
- Media controls, volume and display brightness
- Application-aware controls for browsers, media players and file managers
- CPU, memory, temperature, network and battery information
- Audio visualization, a focus timer and small games
- Automatic detach and re-attach during suspend and resume

## Installation

react-drm replaces the existing Touch Bar interface. `tiny-dfr`,
`mac-touchbar-plus` and other Touch Bar daemons must not run alongside it.

From the KaiT2en repository root, install or update only react-drm with:

```sh
sudo ./scripts/fedora/install-apps.sh --react-drm-only
```

The react-drm directory provides an equivalent shortcut that is run as the
desktop user:

```sh
./apps/react-drm/install.sh
```

The installer:

- verifies that the Mac model has a T2 Touch Bar;
- installs the Fedora build and runtime dependencies;
- removes conflicting Touch Bar daemons;
- installs the udev rules and required user groups;
- copies the current source to `~/react-drm` and builds it there;
- builds the Touch Bar configuration GUI and adds it to the application menu;
- installs Window Monitor Pro when GNOME is active;
- installs and starts `react-drm.service` for the invoking user.

Run the same command after updating the KaiT2en repository. It rebuilds only
react-drm; `t2-fan-control` and `t2-smc-control` are not rebuilt. The complete
KaiT2en application installer remains available as:

```sh
sudo ./scripts/fedora/install-apps.sh
```

### Uninstall

Run the separate uninstaller as the desktop user:

```sh
./apps/react-drm/uninstall.sh
```

It stops and removes the react-drm user service, restores the firmware Touch
Bar interface and removes the react-drm udev rules. Project files, npm
dependencies, system packages and `video`/`input` group memberships are left
unchanged.

### Service status

Check its status and log with:

```sh
systemctl --user status react-drm.service
journalctl --user -u react-drm.service -b
```

The service runs without root privileges. It attaches the Touch Bar when the
graphical session starts, restores the firmware interface when the session
ends and handles suspend and resume. The firmware function-key strip remains
available before login and after logout.

## Manual start

Stop the user service before running the control center manually:

```sh
systemctl --user stop react-drm.service
cd apps/react-drm/linux-touchbar-control-center
npm run dev
```

`npm run dev` is the development entrypoint and keeps hot reload enabled. The
installed systemd service uses the compiled production build instead.

## Browser preview (no Touch Bar / DRM hardware)

Touch Bar UI can be developed and previewed in an ordinary desktop browser —
no MacBook, no Touch Bar, no `/dev/dri` device and no root required. The
preview shows the *actual* pixels the native Cairo renderer draws (the same
renderer the physical Touch Bar uses), streamed over WebSocket to a
`<canvas>`. It is not a separate HTML/DOM re-implementation of the UI:

```
React → react-drm renderer → Cairo → in-memory framebuffer
                                        ├─ production  → DRM/KMS → physical Touch Bar
                                        └─ development → WebSocket → browser <canvas>
```

**Dependencies**: the same native build dependencies as DRM mode (Node.js,
a C++ compiler and the libdrm/Cairo/librsvg/pango development headers — see
[Manual installation](#manual-installation)). A DRM device, root and Touch Bar
hardware are only needed to compile the native addon once, not to *run*
preview mode.

**Build** once from the repository root:

```sh
npm run build
```

**Run** — from `linux-touchbar-control-center`:

```sh
npm run dev          # real Touch Bar over DRM/KMS
npm run dev:preview  # browser preview instead
```

`dev:preview` sets `REACT_DRM_BACKEND=preview`, which makes `createDisplay()`
construct a `PreviewDisplay` (an in-memory framebuffer wrapped by the same
`CairoRenderer` class the DRM path uses) instead of `DrmDisplay`, and starts a
small HTTP + WebSocket server. It prints:

```
[react-drm] preview server running
  http://127.0.0.1:8787
```

**Open that URL** in a browser to see the Touch Bar. The canvas is the real
logical Touch Bar resolution (2008×60 by default — the same fallback size used
elsewhere in the project) and is scaled up with CSS for visibility;
scaling is nearest-neighbor so it stays pixel-accurate.

Backend selection follows the project's existing environment-variable
convention (alongside `REACT_DRM_DEVICE_PATH`, `REACT_DRM_PROFILE`, etc.):

| Variable                  | Values                     | Default | Meaning |
|----------------------------|-----------------------------|---------|---------|
| `REACT_DRM_BACKEND`        | `drm` \| `preview`          | `drm`   | Which display backend `createDisplay()` builds |
| `REACT_DRM_PREVIEW_PORT`   | port number                 | `8787`  | Preview HTTP/WebSocket port |

### Input mapping

Mouse and touch on the preview page simulate Touch Bar touch input:

| Browser event                                | Touch Bar equivalent |
|-----------------------------------------------|-----------------------|
| `mousedown` / `touchstart`                    | finger down |
| `mousemove` while pressed / `touchmove`       | finger drag |
| `mouseup` / `touchend`                        | finger up |

The page converts its own canvas coordinates to logical Touch Bar pixel
coordinates (accounting for the CSS scale factor), sends them as small JSON
WebSocket messages (`{ type: "touchstart" | "touchmove" | "touchend", x, y }`),
and the preview server forwards them directly into the same
`touchStart`/`touchMove`/`touchEnd` API real Touch Bar hardware already
drives — there is no separate input system for the preview.

### Standalone panel window (no browser tab)

`preview-app/` docks the preview to the bottom of the screen as a real panel
— reserved space, like waybar — instead of requiring a manual browser tab.
It's a small Python/GTK app (`gtk_layer_app.py`) using
[`gtk-layer-shell`](https://github.com/wmww/gtk-layer-shell) (the same
library waybar itself is built with) to anchor a window via the Wayland
layer-shell protocol, with an exclusive zone that actually reserves the
space so other windows don't overlap it.

**This requires a layer-shell compositor** — niri, Sway, Hyprland, River, or
similar wlroots-family Wayland compositors. It does not apply to GNOME, KDE,
or X11-only sessions; there's no equivalent protocol there for a
non-compositor app to reserve screen space.

It draws no HTML/DOM UI and doesn't embed a browser engine at all: it speaks
`preview-server.ts`'s WebSocket protocol directly (a small hand-rolled RFC
6455 client — see the comment at the top of `gtk_layer_app.py` for why it
doesn't use libsoup's client) and paints the received RGBA bytes straight
onto a `GtkImage` via `GdkPixbuf`, which matches the wire format byte-for-byte
with no conversion needed.

Dependencies (all standard Linux desktop packages — nothing to install via
npm): `python3-gobject`, `gtk3`, `gtk-layer-shell`. On Fedora:

```sh
sudo dnf install python3-gobject gtk3 gtk-layer-shell
```

Start the preview server first, from `linux-touchbar-control-center`:

```sh
npm run dev:preview
```

Then in another terminal, from the repository root:

```sh
npm run preview:window
```

Press <kbd>Esc</kbd> while it's focused to close it (it has no titlebar).

### Notes

- A frame is only sent when the renderer actually produces one — the existing
  flush-rate cap (`RenderOptions.flushFps`, default 30) already throttles
  this upstream, so there's no added busy loop. A slow or backed-up browser
  tab has frames dropped for it rather than queued in memory.
- The server keeps the last frame in memory, so reloading the page or opening
  a second tab shows the current UI immediately instead of a blank canvas.
- The control center still opens a real keyboard device for global shortcuts
  (e.g. the screenshot combo) even in preview mode — this needs the same
  `video`/`input` group membership and fresh login session as
  [Manual installation](#manual-installation) already describes. Touch Bar
  hardware and a DRM device are not needed either way.

## Active window integration

Application-specific controls require an active-window backend. The KaiT2en
installer deploys the required backend and react-drm selects it automatically:

- GNOME Wayland uses
  [Window Monitor Pro](https://extensions.gnome.org/extension/8549/window-monitor-pro/),
  maintained by the react-drm developer
- KDE Plasma Wayland uses KWin scripting
- Hyprland uses its IPC socket
- Xorg uses `xprop`

On GNOME Wayland the KaiT2en installer includes and enables Window Monitor Pro.
A logout and login may be required when the extension is installed for the
first time. `xprop` must be installed for Xorg sessions. Unsupported Wayland
desktops can still run the Touch Bar UI, but application-specific controls
that depend on the focused window will not work.

## Media progress bar support (mpris)

The control center displays a visual playback progress bar for media players
that expose an MPRIS2 D-Bus interface. Spotify registers its own
`org.mpris.MediaPlayer2.spotify` service and works without additional setup.

Current Brave and Chromium builds expose their media sessions directly through
MPRIS2. This also works when the browser is installed as a Flatpak. Verify the
active service during playback with:

```sh
busctl --user list | grep org.mpris.MediaPlayer2
```

react-drm recognizes `brave` and `chromium` services directly. Some other
Chromium-based browsers do not expose MPRIS2. For those browsers, Plasma Browser
Integration can provide an
`org.mpris.MediaPlayer2.plasma-browser-integration` service:

- [Chrome Web Store](https://chromewebstore.google.com/detail/plasma-integration/cimiefiiaegbelhefglklhhakcgmhkai)
- [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/plasma-integration/)

The extension requires the native Plasma Browser Integration host supplied by
the distribution; the extension alone cannot publish a D-Bus service. The
progress bar works on any desktop once an MPRIS2 service is present. It updates
live, shows album art embedded in the track title row, and supports seek
(tap/drag on the progress track or use the skip-back/skip-forward buttons).

## Keyboard shortcuts

Physical keyboard shortcuts recognised by the control center. All shortcuts
are injected via uinput. They work regardless of which application has focus.

### Layer navigation

| Shortcut | Action |
|---|---|
| Long-press **Fn** | Toggle the F‑key layer (F1–F12 and Esc on wide Touch Bars). Hold again to return. |
| Long-press **Right Alt** (⌥) | Toggle the app dock. Long-press again to close it and return to the previous layer. |

### Screenshots

| Shortcut | Action |
|---|---|
| **Ctrl + Alt + S** | Save the current Touch Bar screen as a PNG into `~/Pictures/touchbar/`. |

### Browser shortcuts

Available when a supported browser window is focused and the Browser Panel is
shown on the left side of the split layer.

| Shortcut | Action |
|---|---|
| **Alt + ←** | Back |
| **Alt + →** | Forward |
| **Ctrl + R** | Reload |
| **Alt + Home** | Home |
| **Ctrl + T** | New tab |
| **Ctrl + W** | Close tab |
| **Ctrl + Tab** | Next tab |
| **Ctrl + Shift + Tab** | Previous tab |

Key overrides per browser can be configured in `linux-touchbar-control-center/config.ts`
(`BROWSER_KEY_OVERRIDES`).

## Konsole integration

The Konsole panel can show suggestions without additional configuration.
Sending commands requires Konsole's security-sensitive D-Bus API:

```sh
kwriteconfig6 --file konsolerc --group KonsoleWindow --key EnableSecuritySensitiveDBusAPI true
```

The key must be stored in the `[KonsoleWindow]` group of
`~/.config/konsolerc`. Konsole reads it only at startup, so close all Konsole
windows before starting it again. With `UseSingleInstance=true`, the process
continues running while any window remains open.

Command suggestions use read-only D-Bus methods and work without this setting.
Enabling the security-sensitive API allows any process on the session bus to
send text and commands to open Konsole sessions.
