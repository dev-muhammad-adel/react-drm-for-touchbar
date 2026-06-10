# react-drm Notes

## Touch Bar Input Detection — vs mac-touchbar-plus

| | mac-touchbar-plus | react-drm |
|---|---|---|
| Device discovery | udev seat lookup (`seat-touchbar`) | `/proc/bus/input/devices` scan |
| Multi-model support | via udev rules | `Touch Bar` pattern covers all 3 known names |
| Hot reconnect | yes — libinput handles it automatically | yes — type=-1 signal + TypeScript retry loop |
| Requires udev rules installed | **yes** — without `99-touchbar-seat.rules`, finds nothing | **no** — works on any machine |
| Requires libinput C library | yes | no |
| Fails clearly if device missing | yes | yes |
| Wrong silent fallback | no | no (removed) |
| Raw evdev parsing | libinput normalizes events | manual EV_ABS parsing in C++ |

### Known Touch Bar input device names (all matched by `Touch Bar` pattern)

| Device name | MacBook model |
|---|---|
| `Apple Inc. Touch Bar Display Touchpad` | MacBook Pro 2018–2021 (T2 chip) |
| `MacBookPro17,1 Touch Bar` | MacBook Pro 13" M1 (2020) |
| `Mac14,7 Touch Bar` | MacBook Pro 13" M2 (2022) |

### Why not udev?

mac-touchbar-plus uses `Libinput::new_with_udev` + `udev_assign_seat("seat-touchbar")`.
This is the correct Linux API but requires:
1. `99-touchbar-seat.rules` to be installed
2. libinput as a native C dependency

Our `/proc` scan is simpler, has no extra dependencies, and works without udev rules.
The only thing libinput adds for the Touch Bar is automatic reconnect — which we now
implement ourselves via the type=-1 disconnect signal from the C++ ReadLoop.

## DRM Card Detection

`DrmDisplay` auto-detects the Touch Bar card by scanning `/sys/class/drm/card*/device/uevent`
for `DRIVER=appletbdrm`. Priority order:

1. Explicit `devicePath` argument
2. `REACT_DRM_DEVICE_PATH` env var
3. First card with `DRIVER=appletbdrm` in sysfs
4. Falls back to `/dev/dri/card1`

mac-touchbar-plus uses a different strategy: tries to open each `/dev/dri/card*` and checks
if the display aspect ratio matches a Touch Bar (very wide, very short). Driver-agnostic but
requires acquiring DRM master lock per card during probing.
