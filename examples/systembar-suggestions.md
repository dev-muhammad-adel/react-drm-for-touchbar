# SystemBar — Center Section Ideas

The center section (`flex: 1`) sits between the back button and the stats modules.
Currently shows the active window title/class.

---

## Implemented

- [x] **Pomodoro timer** — countdown ring + session dots, tap to start/pause, reset button

---

## Media

- [ ] **Now Playing** — playerctl metadata: artist · track + live scrub bar, tap to seek
- [ ] **Audio sink selector** — tap to cycle between pipewire output devices
- [ ] **Microphone status** — muted/live indicator with tap-to-toggle

---

## Productivity

- [ ] **Todo / next task** — read from `~/.todo` or pipe, tap to mark done
- [ ] **Calendar event** — next meeting from `calcurse` / `khal`, glows red when <15 min away
- [ ] **Clipboard preview** — last copied text (truncated), tap to clear

---

## System

- [ ] **GPU stats** — temp + VRAM via `nvidia-smi` or `/sys/class/drm`
- [ ] **Disk I/O** — read/write rates from `/proc/diskstats`
- [ ] **Top process** — whichever process is eating the most CPU right now
- [ ] **Pending updates** — `checkupdates | wc -l` polled every few minutes, glows when nonzero
- [ ] **VPN indicator** — detect `tun0`/`wg0`, show connected IP or "no vpn"

---

## Desktop / Environment

- [ ] **Hyprland workspaces** — live via `$HYPRLAND_INSTANCE_SIGNATURE` IPC socket, tap to switch
- [ ] **Workspace switcher (generic)** — numbered touch buttons for virtual desktops
- [ ] **Volume / brightness sliders** — touch-draggable horizontal bars

---

## Fun / Decorative

- [ ] **ASCII spark graph** — rolling 30s CPU history as `▁▂▃▄▅▆▇█`
- [ ] **Weather** — `curl wttr.in/?format=3` on a timer, shows city + condition + temp
- [ ] **Typing speed** — live WPM meter tracking keystrokes
- [ ] **Uptime bar** — visual "health" ribbon that fills over time since boot
- [ ] **Nothing** — clean dark spacer, let the stats breathe
