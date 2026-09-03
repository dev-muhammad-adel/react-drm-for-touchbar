#include "key_injector.h"
#include <fcntl.h>
#include <unistd.h>
#include <cstring>
#include <linux/uinput.h>
#include <vector>

// Highest defined Linux key code (KEY_MAX in input-event-codes.h).
#ifndef KEY_MAX
#define KEY_MAX 0x2ff
#endif

Napi::Object KeyInjector::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(env, "KeyInjector", {
    InstanceMethod("keyDown",    &KeyInjector::KeyDown),
    InstanceMethod("keyUp",      &KeyInjector::KeyUp),
    InstanceMethod("pressKey",   &KeyInjector::PressKey),
    InstanceMethod("pressCombo", &KeyInjector::PressCombo),
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
  // Register EVERY Linux key code so any key chosen in the config is actually
  // injected. uinput only emits events for keys whose UI_SET_KEYBIT was set at
  // setup, so a fixed whitelist silently dropped everything else ("react-drm
  // doesn't support that key"). KEY_MAX (0x2ff) is the last defined constant.
  for (int k = 1; k <= KEY_MAX; ++k)
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

void KeyInjector::SendKeyState(int keycode, int value) {
  SendEvent(EV_KEY, keycode, value);
  SendEvent(EV_SYN, SYN_REPORT, 0);
}

void KeyInjector::SendKey(int keycode) {
  SendKeyState(keycode, 1);
  SendKeyState(keycode, 0);
}

Napi::Value KeyInjector::KeyDown(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "keyDown(keycode: number)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (fd_ >= 0) SendKeyState(info[0].As<Napi::Number>().Int32Value(), 1);
  return env.Undefined();
}

Napi::Value KeyInjector::KeyUp(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "keyUp(keycode: number)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (fd_ >= 0) SendKeyState(info[0].As<Napi::Number>().Int32Value(), 0);
  return env.Undefined();
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

void KeyInjector::SendCombo(const std::vector<int>& keycodes) {
  for (int k : keycodes)
    SendEvent(EV_KEY, k, 1);
  SendEvent(EV_SYN, SYN_REPORT, 0);
  for (int i = (int)keycodes.size() - 1; i >= 0; --i)
    SendEvent(EV_KEY, keycodes[i], 0);
  SendEvent(EV_SYN, SYN_REPORT, 0);
}

Napi::Value KeyInjector::PressCombo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsArray()) {
    Napi::TypeError::New(env, "pressCombo(keycodes: number[])").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto arr = info[0].As<Napi::Array>();
  std::vector<int> keycodes;
  keycodes.reserve(arr.Length());
  for (uint32_t i = 0; i < arr.Length(); ++i)
    keycodes.push_back(arr.Get(i).As<Napi::Number>().Int32Value());
  if (fd_ >= 0) SendCombo(keycodes);
  return env.Undefined();
}
