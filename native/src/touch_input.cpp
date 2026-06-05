#include "touch_input.h"
#include <fcntl.h>
#include <unistd.h>
#include <linux/input.h>

// These match linux/input-event-codes.h but we define locally to avoid
// collisions with the <linux/input.h> macros included by napi/node headers.
static constexpr uint16_t TB_ABS_MT_POSITION_X  = 0x35;
static constexpr uint16_t TB_ABS_MT_POSITION_Y  = 0x36;
static constexpr uint16_t TB_ABS_MT_TRACKING_ID = 0x39;
static constexpr uint16_t TB_BTN_TOUCH           = 0x14a;

Napi::Object TouchReader::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(env, "TouchReader", {
    InstanceMethod("start", &TouchReader::Start),
    InstanceMethod("stop",  &TouchReader::Stop),
  });
  exports.Set("TouchReader", func);
  return exports;
}

TouchReader::TouchReader(const Napi::CallbackInfo& info)
  : Napi::ObjectWrap<TouchReader>(info) {
  std::string path = "/dev/input/event7";
  if (info.Length() > 0 && info[0].IsString())
    path = info[0].As<Napi::String>().Utf8Value();
  fd_ = open(path.c_str(), O_RDONLY | O_CLOEXEC);
  if (fd_ < 0)
    Napi::Error::New(info.Env(), "Cannot open touch device: " + path)
      .ThrowAsJavaScriptException();
}

TouchReader::~TouchReader() {
  running_ = false;
  int fd = fd_; fd_ = -1;
  if (fd >= 0) close(fd);
  if (thread_.joinable()) thread_.join();
}

Napi::Value TouchReader::Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "start(callback) expects a function").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  tsfn_ = Napi::ThreadSafeFunction::New(
    env, info[0].As<Napi::Function>(), "TouchReader", 0, 1);
  running_ = true;
  int fd = fd_;
  thread_ = std::thread(&TouchReader::ReadLoop, this, fd);
  return env.Undefined();
}

Napi::Value TouchReader::Stop(const Napi::CallbackInfo& info) {
  running_ = false;
  int fd = fd_; fd_ = -1;
  if (fd >= 0) close(fd);
  if (thread_.joinable()) thread_.join();
  return info.Env().Undefined();
}

void TouchReader::ReadLoop(int fd) {
  struct input_event ev;
  int32_t cur_x = 0, cur_y = 0;
  bool touch_active = false;
  bool pos_dirty = false; // position changed since last sync

  // Emit (type, x, y): type 0=start  1=move  2=end
  auto emit = [&](int type, int32_t x, int32_t y) {
    tsfn_.NonBlockingCall([type, x, y](Napi::Env env, Napi::Function cb) {
      cb.Call({
        Napi::Number::New(env, type),
        Napi::Number::New(env, x),
        Napi::Number::New(env, y),
      });
    });
  };

  while (running_) {
    ssize_t n = read(fd, &ev, sizeof(ev));
    if (n != (ssize_t)sizeof(ev)) break;

    if (ev.type == EV_ABS && ev.code == TB_ABS_MT_POSITION_X) {
      cur_x = ev.value;
      if (touch_active) pos_dirty = true;
    }
    if (ev.type == EV_ABS && ev.code == TB_ABS_MT_POSITION_Y) {
      cur_y = ev.value;
    }

    if (ev.type == EV_KEY && ev.code == TB_BTN_TOUCH) {
      if (ev.value == 1 && !touch_active) {
        touch_active = true;
        pos_dirty = false;
        emit(0, cur_x, cur_y); // start
      } else if (ev.value == 0 && touch_active) {
        touch_active = false;
        pos_dirty = false;
        emit(2, cur_x, cur_y); // end
      }
    }

    if (ev.type == EV_ABS && ev.code == TB_ABS_MT_TRACKING_ID) {
      if (ev.value >= 0 && !touch_active) {
        touch_active = true;
        pos_dirty = false;
        emit(0, cur_x, cur_y); // start
      } else if (ev.value < 0 && touch_active) {
        touch_active = false;
        pos_dirty = false;
        emit(2, cur_x, cur_y); // end
      }
    }

    // SYN_REPORT: flush accumulated position into a move event
    if (ev.type == EV_SYN && ev.code == 0 && touch_active && pos_dirty) {
      emit(1, cur_x, cur_y); // move
      pos_dirty = false;
    }
  }
  tsfn_.Release();
}
