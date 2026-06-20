#pragma once
#include <napi.h>
#include <atomic>
#include <thread>

class KeyboardReader : public Napi::ObjectWrap<KeyboardReader> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  KeyboardReader(const Napi::CallbackInfo& info);
  ~KeyboardReader();

private:
  Napi::Value Start(const Napi::CallbackInfo& info);
  Napi::Value Stop(const Napi::CallbackInfo& info);
  Napi::Value IsAlive(const Napi::CallbackInfo& info);

  void ReadLoop(int fd, int cancel_rfd);
  void DoStop();

  int               fd_         = -1;
  int               cancel_rfd_ = -1;
  int               cancel_wfd_ = -1;
  std::atomic<bool> running_    { false };
  std::thread       thread_;
  Napi::ThreadSafeFunction tsfn_;
};
