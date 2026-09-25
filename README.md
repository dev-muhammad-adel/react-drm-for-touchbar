# react-drm

react-drm provides a React renderer for drawing directly to Linux DRM/KMS
displays using libdrm and Cairo. This repository includes a control center
that replaces the standard Touch Bar interface on T2 MacBooks running Linux.

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

### Installer

Run the installer as your regular user from the repository root:

```sh
./install.sh
```

The installer performs three phases:

1. **Analysis** detects the system, session, hardware, kernel modules,
   conflicting daemons and required packages. It resolves the complete package
   transaction without changing the system.
2. **Purge** stops and removes detected `tiny-dfr` or `mac-touchbar-plus`
   installations after a separate confirmation.
3. **Deploy** installs dependencies, builds the current local source, installs
   the udev rules and production user service, and starts react-drm.

It can also update an existing installation. Update the local source using the
same method used to obtain it, then run the updated `install.sh` again. The
installer does not download source updates itself.

Supported installer environments:

- Fedora 44 or newer
- Debian 13 or newer
- Ubuntu 25.10 or newer and Ubuntu derivatives that provide Node.js 20.19.0
  or newer
- Arch Linux and supported Arch derivatives
- GNOME, KDE Plasma, Niri or Hyprland on Wayland
- Any Xorg desktop with `xprop`

Ubuntu 24.04 is not supported because its repositories provide Node.js 18.
react-drm requires Node.js 20.19.0 or newer. NixOS is detected but requires a
native Nix package or module and is not modified by the installer. Other
Wayland desktops currently lack an active-window backend and are rejected by
the installer.

Arch-based systems receive a full `pacman -Syu` because partial upgrades are
unsupported. Debian and Ubuntu package lists and Fedora repository metadata
are refreshed before package installation.

Run only the non-destructive analysis with:

```sh
./install.sh analyze
```

### Uninstall

Run the separate uninstaller from the repository root:

```sh
./uninstall.sh
```

It stops and removes the react-drm user service, restores the firmware Touch
Bar interface and removes the react-drm udev rules. Project files, npm
dependencies, system packages and `video`/`input` group memberships are left
unchanged.

### Manual installation

Use this path for unsupported distributions or desktop environments. Package
names differ between distributions, so install the equivalents of:

- Node.js 20.19.0 or newer, npm and Python 3 for `node-gyp`
- A C++ compiler, `make` and `pkg-config`
- Development files for libdrm, Cairo, librsvg and libudev/systemd
- `brightnessctl` and `cava`
- `xprop` when using Xorg
- systemd/logind and a systemd user session for suspend handling and the
  supplied service

The kernel must provide `appletbdrm` and `hid-appletb-bl`. Verify both before
continuing:

```sh
modinfo appletbdrm
modinfo hid-appletb-bl
```

Stop, disable and remove `tiny-dfr`, `mac-touchbar-plus` or any other Touch Bar
daemon using the method appropriate for your distribution.

Build the control center workspace. `npm ci` must be run from the repository root
to use the root lockfile:

```sh
npm ci
cd linux-touchbar-control-center
npm run build
```

`npm ci` may show deprecation warnings for `npmlog`, `are-we-there-yet` and
`gauge`. They are transitive dependencies of `@benmalka/foxdriver` and do not
by themselves indicate a failed build.

Add your user to the groups required for DRM access, input devices and key
injection:

```sh
sudo usermod -aG video,input "$USER"
```

Install and apply the udev rules:

```sh
sudo install -m 0644 system/99-react-drm.rules /etc/udev/rules.d/99-react-drm.rules
sudo udevadm control --reload
sudo udevadm trigger --action=add --subsystem-match=usb --subsystem-match=backlight
```

`uinput` has no hardware to bind to, so nothing ever auto-loads it and the
trigger above cannot apply the udev rule to a device that doesn't exist yet.
Load the module directly and persist it across reboots:

```sh
sudo modprobe uinput
echo uinput | sudo tee /etc/modules-load.d/react-drm-uinput.conf
```

Log out of the desktop session and back in before starting react-drm. Opening a
new terminal is not sufficient to activate the new supplementary groups.

After logging back in, install the service:

```sh
install -Dm644 system/react-drm.service ~/.config/systemd/user/react-drm.service
```

The supplied unit expects the repository at `~/react-drm`. If it is stored
elsewhere, edit `WorkingDirectory`, `ExecStart` and `ExecStopPost` in
`~/.config/systemd/user/react-drm.service` to use its absolute path. The unit
runs the compiled app with `node dist/index.js` and sets `NODE_ENV=production`;
it does not run the TypeScript entrypoint or hot reload watcher.

Then enable and start it:

```sh
systemctl --user daemon-reload
systemctl --user enable --now react-drm.service
```

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
cd linux-touchbar-control-center
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

Application-specific controls require an active-window backend. The matching
backend is selected automatically:

- GNOME Wayland uses
  [Window Monitor Pro](https://extensions.gnome.org/extension/8549/window-monitor-pro/),
  maintained by the react-drm developer
- KDE Plasma Wayland uses KWin scripting
- Hyprland uses its IPC socket
- Xorg uses `xprop`

Window Monitor Pro must be installed and enabled on GNOME Wayland. `xprop`
must be installed for Xorg sessions. Unsupported Wayland desktops can still
run the Touch Bar UI after manual installation, but application-specific
controls that depend on the focused window will not work.

## Media progress bar support (mpris)

The control center displays a visual playback progress bar for media players
that expose an MPRIS2 D-Bus interface. Spotify registers its own
`org.mpris.MediaPlayer2.spotify` service and works without additional setup.

Chrome, Chromium and other Chromium-based browsers do not provide a native
MPRIS2 service on Linux. For these browsers install the
**Plasma Browser Integration** extension:

- [Chrome Web Store](https://chromewebstore.google.com/detail/plasma-integration/cimiefiiaegbelhefglklhhakcgmhkai)
- [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/plasma-integration/)

Despite the name, this extension is **not KDE-specific**. It registers an
`org.mpris.MediaPlayer2.plasma-browser-integration` D-Bus service that any
desktop environment (GNOME, Hyprland, Xorg, …) can read. The progress bar
appears on the Touch Bar regardless of which DE you run.

No host-side package (`plasma-browser-integration` or similar) is required,
the extension alone is sufficient. The progress bar updates live, shows album
art embedded in the track title row, and supports seek (tap/drag on the
progress track or use the skip-back/skip-forward buttons).

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
