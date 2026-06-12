# react-drm

React renderer targeting Linux DRM/KMS via libdrm + Cairo, built for the Apple Touch Bar on Linux.

## Prerequisites

- T2 MacBook with the `appletbdrm` and `hid-appletb-bl` kernel modules available
- Node.js with native addon support (`node-gyp`)
- `libdrm`, `libcairo` development headers
- **No other Touch Bar daemon**: remove `tiny-dfr` / `mac-touchbar-plus` first — it competes for the Touch Bar display and the install below assumes it is gone

## Build

```sh
npm install
npm run build
```

## Run examples (foreground)

```sh
cd examples
npm install
npx tsx <example-file>.tsx
```

## Install as a service

Runs the example app (`examples/index.tsx`) as an unprivileged user service tied
to your graphical session — no root, no sudo rules. Lifecycle: the firmware
fn-key strip stays on the Touch Bar from power-on until login (the USB device
sits in config 1, so the `appletbdrm` driver never loads), the app switches
the device to config 2 at startup (the kernel auto-loads the driver), and the
fn strip comes back at logout (the unit's `ExecStopPost` detach). Suspend and
resume are handled by the app itself: it holds a logind delay inhibitor,
releases the bar before suspend (the t2 sleep fix can't remove `apple-bce`
safely while something holds the bar) and re-attaches on resume — the same
code paths a manual `npm run dev` uses.

All files live in `system/`; each also carries its install command in its
header comment. The unit calls the detach helper from the repo and assumes it
is at `~/react-drm` — edit the paths in `system/react-drm.service` otherwise.

1. **Device access** — card nodes are `root:video`, evdev needs `input`:

   ```sh
   sudo usermod -aG video,input $USER   # re-login to take effect
   ```

2. **udev rules** — own logind seat for the Touch Bar (keeps the main
   compositor from claiming it), group-writable USB config switch and
   backlight, USB runtime PM pinned off (autosuspend deadlocks the
   `hid_appletb_kbd` driver, wedging the device until reboot — and tools like
   `powertop --auto-tune` would silently re-enable it):

   ```sh
   sudo install -m644 system/99-react-drm.rules /etc/udev/rules.d/
   sudo udevadm control --reload
   sudo udevadm trigger --action=add --subsystem-match=usb --subsystem-match=backlight
   ```

3. **User unit** — starts/stops with the graphical session:

   ```sh
   install -Dm644 system/react-drm.service ~/.config/systemd/user/react-drm.service
   systemctl --user daemon-reload
   systemctl --user enable react-drm
   ```

   Make sure `examples/` has its dependencies (`cd examples && npm install`),
   then reboot — the fn strip should be visible until login, after which
   react-drm takes the bar. Check with `systemctl --user status react-drm`
   and `journalctl --user -u react-drm`.

## Konsole D-Bus API (required for the Konsole panel)

The Konsole example panel (`examples/layers/leftsideLayers/KonsolePanel.tsx`) sends suggested commands to Konsole via the `org.kde.konsole.Session.sendText` D-Bus method. Since Konsole 22.04 this method (along with `runCommand`) is disabled by default and fails with:

```
Security sensitive DBus API is disabled in the settings.
```

To enable it, either check **Settings → Configure Konsole → General → "Enable the security sensitive parts of the DBus API"**, or set it from the command line:

```sh
kwriteconfig6 --file konsolerc --group KonsoleWindow --key EnableSecuritySensitiveDBusAPI true
```

The key must be in the `[KonsoleWindow]` group of `~/.config/konsolerc`. Konsole only reads it at startup, so fully quit Konsole afterwards (close all windows — with `UseSingleInstance=true` the process keeps running as long as any window is open) and launch it again.

Read-only methods used for the suggestion list (`getAllDisplayedText`, `foregroundProcessId`) are not gated, so suggestions appear even when sending is blocked.

> **Security note:** this allows any process on your session bus to type into and run commands in your Konsole sessions. Only enable it if you're comfortable with that trade-off.
