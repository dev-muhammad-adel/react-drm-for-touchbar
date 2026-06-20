#include "keyboard_reader.h"
#include <fcntl.h>
#include <poll.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <linux/input.h>

Napi::Object KeyboardReader::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(env, "KeyboardReader", {
    InstanceMethod("start",   &KeyboardReader::Start),
    InstanceMethod("stop",    &KeyboardReader::Stop),
    InstanceMethod("isAlive", &KeyboardReader::IsAlive),
  });
  exports.Set("KeyboardReader", func);
  return exports;
}

KeyboardReader::KeyboardReader(const Napi::CallbackInfo& info)
  : Napi::ObjectWrap<KeyboardReader>(info) {
  std::string path = "/dev/input/event0";
  if (info.Length() > 0 && info[0].IsString())
    path = info[0].As<Napi::String>().Utf8Value();

  fd_ = open(path.c_str(), O_RDONLY | O_CLOEXEC);
  if (fd_ < 0)
    Napi::Error::New(info.Env(), "Cannot open keyboard device: " + path)
      .ThrowAsJavaScriptException();

  int pipe_fds[2];
  if (pipe2(pipe_fds, O_CLOEXEC) == 0) {
    cancel_rfd_ = pipe_fds[0];
    cancel_wfd_ = pipe_fds[1];
  }
}

KeyboardReader::~KeyboardReader() {
  DoStop();
}

void KeyboardReader::DoStop() {
  if (!running_.exchange(false)) {
    if (fd_ >= 0)         { close(fd_);         fd_         = -1; }
    if (cancel_rfd_ >= 0) { close(cancel_rfd_); cancel_rfd_ = -1; }
    if (cancel_wfd_ >= 0) { close(cancel_wfd_); cancel_wfd_ = -1; }
    return;
  }
  if (cancel_wfd_ >= 0) { char c = 1; write(cancel_wfd_, &c, 1); }
  if (thread_.joinable()) thread_.join();
  if (fd_ >= 0)         { close(fd_);         fd_         = -1; }
  if (cancel_rfd_ >= 0) { close(cancel_rfd_); cancel_rfd_ = -1; }
  if (cancel_wfd_ >= 0) { close(cancel_wfd_); cancel_wfd_ = -1; }
}

Napi::Value KeyboardReader::Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "start(callback) expects a function").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  tsfn_ = Napi::ThreadSafeFunction::New(
    env, info[0].As<Napi::Function>(), "KeyboardReader", 0, 1);
  running_ = true;
  thread_ = std::thread(&KeyboardReader::ReadLoop, this, fd_, cancel_rfd_);
  return env.Undefined();
}

Napi::Value KeyboardReader::Stop(const Napi::CallbackInfo& info) {
  DoStop();
  return info.Env().Undefined();
}

// Cheap, non-destructive liveness probe of the *existing* fd — does NOT re-open
// or re-scan, so it can't race the BCE/input re-enumeration. Returns false when
// the fd is closed, poll reports the device gone (POLLHUP/POLLERR/POLLNVAL), or
// the evdev ioctl fails. NOTE: all of these read kernel-cached state with no USB
// round-trip, so a device whose transport silently stalled (events stop but the
// node persists) will still report alive — that's the case the resume logging is
// meant to reveal.
Napi::Value KeyboardReader::IsAlive(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (fd_ < 0) return Napi::Boolean::New(env, false);

  struct pollfd p { fd_, 0, 0 };
  if (poll(&p, 1, 0) < 0) return Napi::Boolean::New(env, false);
  if (p.revents & (POLLHUP | POLLERR | POLLNVAL)) return Napi::Boolean::New(env, false);

  struct input_id id;
  if (ioctl(fd_, EVIOCGID, &id) < 0) return Napi::Boolean::New(env, false);

  return Napi::Boolean::New(env, true);
}

// Emits (code, value) for every EV_KEY event.
// value: 0 = released, 1 = pressed, 2 = repeat (still held)
// code=-1, value=-1 signals device disconnect so TypeScript can reconnect.
void KeyboardReader::ReadLoop(int fd, int cancel_rfd) {
  struct input_event ev;
  bool device_error = false;

  struct pollfd pfds[2];
  pfds[0].fd = fd;          pfds[0].events = POLLIN;
  pfds[1].fd = cancel_rfd;  pfds[1].events = POLLIN;

  while (running_) {
    int ret = poll(pfds, 2, -1);
    if (ret <= 0) { device_error = true; break; }
    if (pfds[1].revents & POLLIN) break;
    if (pfds[0].revents & (POLLHUP | POLLERR)) { device_error = true; break; }
    if (!(pfds[0].revents & POLLIN)) continue;

    ssize_t n = read(fd, &ev, sizeof(ev));
    if (n != (ssize_t)sizeof(ev)) { device_error = true; break; }

    if (ev.type == EV_KEY) {
      uint16_t code  = ev.code;
      int32_t  value = ev.value;
      tsfn_.NonBlockingCall([code, value](Napi::Env env, Napi::Function cb) {
        cb.Call({
          Napi::Number::New(env, code),
          Napi::Number::New(env, value),
        });
      });
    }
  }
  if (device_error) {
    tsfn_.NonBlockingCall([](Napi::Env env, Napi::Function cb) {
      cb.Call({ Napi::Number::New(env, -1),
                Napi::Number::New(env, -1) });
    });
  }
  tsfn_.Release();
}
