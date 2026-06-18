#include "touch_input.h"
#include <fcntl.h>
#include <poll.h>
#include <unistd.h>
#include <linux/input.h>

// These match linux/input-event-codes.h but we define locally to avoid
// collisions with the <linux/input.h> macros included by napi/node headers.
static constexpr uint16_t TB_ABS_MT_SLOT        = 0x2f;
static constexpr uint16_t TB_ABS_MT_POSITION_X  = 0x35;
static constexpr uint16_t TB_ABS_MT_POSITION_Y  = 0x36;
static constexpr uint16_t TB_ABS_MT_TRACKING_ID = 0x39;

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

  int pipe_fds[2];
  if (pipe2(pipe_fds, O_CLOEXEC) == 0) {
    cancel_rfd_ = pipe_fds[0];
    cancel_wfd_ = pipe_fds[1];
  }
}

TouchReader::~TouchReader() {
  DoStop();
}

// Signal the read loop to exit and join the thread. Safe to call multiple times.
void TouchReader::DoStop() {
  if (!running_.exchange(false)) {
    // Thread never started or already stopped — just close any open fds.
    if (fd_ >= 0)         { close(fd_);         fd_         = -1; }
    if (cancel_rfd_ >= 0) { close(cancel_rfd_); cancel_rfd_ = -1; }
    if (cancel_wfd_ >= 0) { close(cancel_wfd_); cancel_wfd_ = -1; }
    return;
  }
  // Wake up the poll() in ReadLoop by writing to the cancel pipe.
  if (cancel_wfd_ >= 0) {
    char c = 1;
    write(cancel_wfd_, &c, 1);
  }
  if (thread_.joinable()) thread_.join();
  // Close everything after the thread has exited.
  if (fd_ >= 0)         { close(fd_);         fd_         = -1; }
  if (cancel_rfd_ >= 0) { close(cancel_rfd_); cancel_rfd_ = -1; }
  if (cancel_wfd_ >= 0) { close(cancel_wfd_); cancel_wfd_ = -1; }
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
  thread_ = std::thread(&TouchReader::ReadLoop, this, fd_, cancel_rfd_);
  return env.Undefined();
}

Napi::Value TouchReader::Stop(const Napi::CallbackInfo& info) {
  DoStop();
  return info.Env().Undefined();
}

void TouchReader::ReadLoop(int fd, int cancel_rfd) {
  struct input_event ev;
  int32_t cur_x = 0, cur_y = 0;
  bool touch_active = false;
  bool touch_starting = false; // deferred start: emit at SYN_REPORT so X/Y are populated
  bool pos_dirty = false;
  // Multitouch slot isolation (MT type-B). The panel reports up to 11 contacts;
  // we follow only the FIRST one (the primary finger) and ignore the rest, so a
  // stray second contact (palm graze, second finger) can't hijack the active
  // touch's coordinate and teleport it across the bar.
  int32_t cur_slot     = 0;   // slot the current ABS_MT_* events address
  int32_t primary_slot = -1;  // slot owning the active touch (-1 = no touch)

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

  struct pollfd pfds[2];
  pfds[0].fd     = fd;
  pfds[0].events = POLLIN;
  pfds[1].fd     = cancel_rfd;
  pfds[1].events = POLLIN;

  bool device_error = false;

  while (running_) {
    int ret = poll(pfds, 2, -1);
    if (ret <= 0) { device_error = true; break; }
    if (pfds[1].revents & POLLIN) break; // cancel pipe triggered by DoStop()
    if (pfds[0].revents & (POLLHUP | POLLERR)) { device_error = true; break; }
    if (!(pfds[0].revents & POLLIN)) continue;

    ssize_t n = read(fd, &ev, sizeof(ev));
    if (n != (ssize_t)sizeof(ev)) { device_error = true; break; }

    // Which slot subsequent ABS_MT_* events address.
    if (ev.type == EV_ABS && ev.code == TB_ABS_MT_SLOT) {
      cur_slot = ev.value;
    }

    // Contact begin/end is per-slot via the tracking id. Only the primary slot
    // drives start/end; contacts in other slots are secondary fingers — ignored.
    if (ev.type == EV_ABS && ev.code == TB_ABS_MT_TRACKING_ID) {
      if (ev.value >= 0) {
        if (primary_slot < 0) {     // first finger down → it becomes primary
          primary_slot   = cur_slot;
          touch_active   = true;
          touch_starting = true;    // defer start until SYN_REPORT so X/Y arrive
          pos_dirty      = false;
        }
      } else if (cur_slot == primary_slot) { // primary finger lifted
        primary_slot   = -1;
        touch_active   = false;
        touch_starting = false;
        pos_dirty      = false;
        emit(2, cur_x, cur_y); // end
      }
    }

    // Position only counts for the primary slot — a secondary finger's X/Y is
    // dropped, so it can never move the active touch.
    if (ev.type == EV_ABS && ev.code == TB_ABS_MT_POSITION_X && cur_slot == primary_slot) {
      cur_x = ev.value;
      if (touch_active) pos_dirty = true;
    }
    if (ev.type == EV_ABS && ev.code == TB_ABS_MT_POSITION_Y && cur_slot == primary_slot) {
      cur_y = ev.value;
      if (touch_active) pos_dirty = true;
    }

    // SYN_REPORT: flush accumulated position
    if (ev.type == EV_SYN && ev.code == 0) {
      if (touch_starting) {
        emit(0, cur_x, cur_y); // start — X and Y are now populated
        touch_starting = false;
        pos_dirty = false;
      } else if (touch_active && pos_dirty) {
        emit(1, cur_x, cur_y); // move
        pos_dirty = false;
      }
    }
  }
  // type=-1 signals device disconnect to TypeScript so it can reconnect
  if (device_error) {
    tsfn_.NonBlockingCall([](Napi::Env env, Napi::Function cb) {
      cb.Call({ Napi::Number::New(env, -1),
                Napi::Number::New(env, 0),
                Napi::Number::New(env, 0) });
    });
  }
  tsfn_.Release();
}
