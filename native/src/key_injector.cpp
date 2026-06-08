#include "key_injector.h"
#include <fcntl.h>
#include <unistd.h>
#include <cstring>
#include <linux/uinput.h>

static constexpr int FKEY_FIRST = 59;  // KEY_F1
static constexpr int FKEY_LAST  = 88;  // KEY_F12 (88)

// Media / system keys to also register
static const int EXTRA_KEYS[] = {
  113, 114, 115,   // KEY_MUTE, KEY_VOLUMEDOWN, KEY_VOLUMEUP
  163, 164, 165,   // KEY_NEXTSONG, KEY_PLAYPAUSE, KEY_PREVIOUSSONG
  125,             // KEY_LEFTMETA (super/app-grid)
  217,             // KEY_SEARCH
  224, 225,        // KEY_BRIGHTNESSDOWN, KEY_BRIGHTNESSUP
  229, 230,        // KEY_KBDILLUMDOWN, KEY_KBDILLUMUP
  248,             // KEY_MICMUTE
};

Napi::Object KeyInjector::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(env, "KeyInjector", {
    InstanceMethod("pressKey", &KeyInjector::PressKey),
  });
  exports.Set("KeyInjector", func);
  return exports;
}

KeyInjector::KeyInjector(const Napi::CallbackInfo& info)
  : Napi::ObjectWrap<KeyInjector>(info) {
  fd_ = open("/dev/uinput", O_WRONLY | O_NONBLOCK | O_CLOEXEC);
  if (fd_ < 0) {
    Napi::Error::New(info.Env(), "Cannot open /dev/uinput — need root or 'uinput' group")
      .ThrowAsJavaScriptException();
    return;
  }

  ioctl(fd_, UI_SET_EVBIT, EV_KEY);
  ioctl(fd_, UI_SET_EVBIT, EV_SYN);
  for (int k = FKEY_FIRST; k <= FKEY_LAST; ++k)
    ioctl(fd_, UI_SET_KEYBIT, k);
  for (int k : EXTRA_KEYS)
    ioctl(fd_, UI_SET_KEYBIT, k);

  struct uinput_setup usetup{};
  strncpy(usetup.name, "react-drm-fkeys", UINPUT_MAX_NAME_SIZE);
  usetup.id.bustype = BUS_USB;
  usetup.id.vendor  = 0x1d6b;
  usetup.id.product = 0x0001;

  if (ioctl(fd_, UI_DEV_SETUP, &usetup) < 0 || ioctl(fd_, UI_DEV_CREATE) < 0) {
    close(fd_); fd_ = -1;
    Napi::Error::New(info.Env(), "Failed to create uinput device")
      .ThrowAsJavaScriptException();
    return;
  }
  usleep(100'000); // wait for the device node to appear
}

KeyInjector::~KeyInjector() {
  if (fd_ >= 0) {
    ioctl(fd_, UI_DEV_DESTROY);
    close(fd_);
  }
}

void KeyInjector::SendEvent(uint16_t type, uint16_t code, int32_t value) {
  struct input_event ev{};
  ev.type  = type;
  ev.code  = code;
  ev.value = value;
  write(fd_, &ev, sizeof(ev));
}

void KeyInjector::SendKey(int keycode) {
  SendEvent(EV_KEY, keycode, 1);
  SendEvent(EV_SYN, SYN_REPORT, 0);
  SendEvent(EV_KEY, keycode, 0);
  SendEvent(EV_SYN, SYN_REPORT, 0);
}

Napi::Value KeyInjector::PressKey(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "pressKey(keycode: number)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (fd_ >= 0) SendKey(info[0].As<Napi::Number>().Int32Value());
  return env.Undefined();
}
