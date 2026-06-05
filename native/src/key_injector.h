#pragma once
#include <napi.h>

class KeyInjector : public Napi::ObjectWrap<KeyInjector> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  KeyInjector(const Napi::CallbackInfo& info);
  ~KeyInjector();

private:
  Napi::Value PressKey(const Napi::CallbackInfo& info);

  void SendEvent(uint16_t type, uint16_t code, int32_t value);
  void SendKey(int keycode);

  int fd_ = -1;
};
