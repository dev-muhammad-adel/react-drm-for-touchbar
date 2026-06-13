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

## Requirements

- A T2 MacBook with the `appletbdrm` and `hid-appletb-bl` kernel modules
- Node.js, npm and a native build toolchain with `node-gyp`, a C++ compiler,
  `make` and `pkg-config`
- Development headers for libdrm, Cairo, librsvg and libudev/systemd
- `brightnessctl` for display brightness
- `cava` for audio visualization
- `playerctl` for media controls

react-drm replaces other Touch Bar daemons. Remove `tiny-dfr` or
`mac-touchbar-plus` before installing it. Some T2 distributions include
`tiny-dfr` by default.

## Installation

Install the dependencies listed above using your distribution's package
manager, then build the project:

```sh
npm ci
npm run build
```

Add your user to the groups required for DRM, input devices and key injection:

```sh
sudo usermod -aG video,input "$USER"
```

Install the udev rules:

```sh
sudo install -m644 system/99-react-drm.rules /etc/udev/rules.d/
sudo udevadm control --reload
sudo udevadm trigger --action=add --subsystem-match=usb --subsystem-match=backlight
sudo udevadm trigger --action=add --subsystem-match=misc --sysname-match=uinput
```

Log out and back in for the new group memberships to take effect.

The supplied user service expects the repository at `~/react-drm`. Edit
`WorkingDirectory`, `ExecStart` and `ExecStopPost` in
`system/react-drm.service` if it is stored elsewhere.

Install and enable the service:

```sh
install -Dm644 system/react-drm.service ~/.config/systemd/user/react-drm.service
systemctl --user daemon-reload
systemctl --user enable --now react-drm
```

Check its status and log with:

```sh
systemctl --user status react-drm
journalctl --user -u react-drm -b
```

The service runs without root privileges. It attaches the Touch Bar when the
graphical session starts, restores the firmware interface when the session
ends and handles suspend and resume. The firmware function-key strip remains
available before login and after logout.

## Manual start

Stop the user service before running the control center manually:

```sh
systemctl --user stop react-drm
cd linux-touchbar-control-center
npm run dev
```

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
must be installed for Xorg sessions.

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
