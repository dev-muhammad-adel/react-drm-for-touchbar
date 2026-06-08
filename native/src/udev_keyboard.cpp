#include "udev_keyboard.h"
#include <libudev.h>
#include <string>
#include <vector>

// ── helpers ───────────────────────────────────────────────────────────────────

static struct udev* make_udev(Napi::Env env) {
  struct udev* u = udev_new();
  if (!u) Napi::Error::New(env, "react-drm: failed to create udev context")
            .ThrowAsJavaScriptException();
  return u;
}

static bool on_seat0(struct udev_device* dev) {
  const char* seat = udev_device_get_property_value(dev, "ID_SEAT");
  return seat == nullptr || std::string(seat) == "seat0";
}

// Enumerate input devices matching a single udev property key=1.
// Returns devnode paths. Pass seat0_only=true to skip other seats.
static std::vector<std::string> enumerate_input(
    struct udev* udev, const char* prop, bool seat0_only)
{
  std::vector<std::string> result;
  struct udev_enumerate* en = udev_enumerate_new(udev);
  udev_enumerate_add_match_subsystem(en, "input");
  udev_enumerate_add_match_property(en, prop, "1");
  udev_enumerate_scan_devices(en);

  struct udev_list_entry* entry;
  udev_list_entry_foreach(entry, udev_enumerate_get_list_entry(en)) {
    struct udev_device* dev = udev_device_new_from_syspath(
        udev, udev_list_entry_get_name(entry));
    if (!dev) continue;

    const char* node = udev_device_get_devnode(dev);
    // Only include evdev event nodes — skip legacy /dev/input/mouse* etc.
    if (node && std::string(node).find("/dev/input/event") == 0
             && (!seat0_only || on_seat0(dev)))
      result.push_back(node);

    udev_device_unref(dev);
  }
  udev_enumerate_unref(en);
  return result;
}

// ── exported functions ────────────────────────────────────────────────────────

Napi::Value FindKeyboardDevice(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  struct udev* udev = make_udev(env);
  if (!udev) return env.Undefined();

  auto devices = enumerate_input(udev, "ID_INPUT_KEYBOARD", true);
  udev_unref(udev);

  if (devices.empty()) {
    Napi::Error::New(env,
      "react-drm: no keyboard found on seat0 via udev. Is a keyboard connected?")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::String::New(env, devices[0]);
}

Napi::Value FindKeyboardDevices(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  struct udev* udev = make_udev(env);
  if (!udev) return env.Undefined();

  auto devices = enumerate_input(udev, "ID_INPUT_KEYBOARD", true);
  udev_unref(udev);

  auto arr = Napi::Array::New(env, devices.size());
  for (size_t i = 0; i < devices.size(); i++)
    arr.Set(i, Napi::String::New(env, devices[i]));
  return arr;
}

Napi::Value FindLidDevice(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  struct udev* udev = make_udev(env);
  if (!udev) return env.Undefined();

  struct udev_enumerate* en = udev_enumerate_new(udev);
  udev_enumerate_add_match_subsystem(en, "input");
  udev_enumerate_add_match_property(en, "ID_INPUT_SWITCH", "1");
  udev_enumerate_scan_devices(en);

  std::string found;
  struct udev_list_entry* entry;
  udev_list_entry_foreach(entry, udev_enumerate_get_list_entry(en)) {
    struct udev_device* dev = udev_device_new_from_syspath(
        udev, udev_list_entry_get_name(entry));
    if (!dev) continue;

    const char* node = udev_device_get_devnode(dev);
    if (node && std::string(node).find("/dev/input/event") == 0) {
      // Check SW_LID capability: /sys/class/input/eventN/device/capabilities/sw
      // SW_LID is bit 0 — sysfs value must have bit 0 set (hex "1" or odd number).
      std::string cap_path = std::string(udev_device_get_syspath(dev))
                             + "/device/capabilities/sw";
      FILE* f = fopen(cap_path.c_str(), "r");
      if (f) {
        unsigned long sw_caps = 0;
        fscanf(f, "%lx", &sw_caps);
        fclose(f);
        if (sw_caps & 1) { // bit 0 = SW_LID
          found = node;
          udev_device_unref(dev);
          break;
        }
      }
    }
    udev_device_unref(dev);
  }

  udev_enumerate_unref(en);
  udev_unref(udev);

  if (found.empty()) {
    Napi::Error::New(env, "react-drm: no lid switch found via udev")
      .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::String::New(env, found);
}

Napi::Value FindPointerDevices(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  struct udev* udev = make_udev(env);
  if (!udev) return env.Undefined();

  // Collect touchpad, touchscreen, and mouse devices across all seats
  // (no seat filter — Touch Bar touchpad is on seat-touchbar but still
  //  counts as user activity for idle detection).
  std::vector<std::string> all;
  for (const char* prop : {"ID_INPUT_TOUCHPAD", "ID_INPUT_TOUCHSCREEN", "ID_INPUT_MOUSE"}) {
    for (auto& p : enumerate_input(udev, prop, false))
      all.push_back(p);
  }
  udev_unref(udev);

  // Deduplicate (a device can have multiple input properties set)
  std::vector<std::string> unique;
  for (auto& p : all) {
    bool found = false;
    for (auto& u : unique) if (u == p) { found = true; break; }
    if (!found) unique.push_back(p);
  }

  auto arr = Napi::Array::New(env, unique.size());
  for (size_t i = 0; i < unique.size(); i++)
    arr.Set(i, Napi::String::New(env, unique[i]));
  return arr;
}
