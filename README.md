# react-drm

React renderer targeting Linux DRM/KMS via libdrm + Cairo, built for the Apple Touch Bar on Linux.

## Prerequisites

- Node.js with native addon support (`node-gyp`)
- `libdrm`, `libcairo` development headers
- Linux with `appletbdrm` and `hid-appletb-bl` kernel modules loaded (T2/M-series MacBooks)

## Build

```sh
npm install
npm run build
```

## Run examples

```sh
cd examples
npm install
npx tsx <example-file>.tsx
```

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

## udev Rules

### Touch Bar seat assignment

Required for separating the Touch Bar input from the main seat. Copy the rules from `99-touchbar-seat.rules` and `99-touchbar-tiny-dfr.rules` if not already installed by your distro package.

### Touch Bar backlight brightness (no sudo)

By default `/sys/class/backlight/appletb_backlight/brightness` is only writable by root. To allow members of the `video` group to write it:

```sh
sudo cp /tmp/99-appletb-backlight.rules /etc/udev/rules.d/99-appletb-backlight.rules
```

Or create `/etc/udev/rules.d/99-appletb-backlight.rules` with:

```
ACTION=="add", SUBSYSTEM=="backlight", KERNEL=="appletb_backlight", RUN+="/bin/chown root:video /sys/class/backlight/%k/brightness", RUN+="/bin/chmod g+w /sys/class/backlight/%k/brightness"
```

Then reload and apply:

```sh
sudo udevadm control --reload
sudo udevadm trigger --action=add --subsystem-match=backlight
```

Add your user to the `video` group if not already a member:

```sh
sudo usermod -aG video $USER
```

The rule persists across reboots — the `chown`/`chmod` re-runs each time the device is added.
