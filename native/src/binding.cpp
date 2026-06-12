#include <napi.h>
#include <memory>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <linux/usbdevice_fs.h>
#include "drm.h"
#include "cairo_renderer.h"
#include "touch_input.h"
#include "key_injector.h"
#include "keyboard_reader.h"
#include "udev_keyboard.h"

class DrmDisplayWrapper : public Napi::ObjectWrap<DrmDisplayWrapper> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "DrmDisplay", {
      InstanceMethod("setup",      &DrmDisplayWrapper::Setup),
      InstanceMethod("render",     &DrmDisplayWrapper::Render),
      InstanceMethod("screenshot", &DrmDisplayWrapper::Screenshot),
      InstanceMethod("getWidth",   &DrmDisplayWrapper::GetWidth),
      InstanceMethod("getHeight",  &DrmDisplayWrapper::GetHeight),
      InstanceMethod("close",      &DrmDisplayWrapper::Close),
    });
    exports.Set("DrmDisplay", func);
    return exports;
  }

  DrmDisplayWrapper(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<DrmDisplayWrapper>(info) {
    std::string path = "/dev/dri/card1";
    if (info.Length() > 0 && info[0].IsString())
      path = info[0].As<Napi::String>().Utf8Value();
    try {
      drm_ = std::make_unique<DrmDevice>(path);
    } catch (const std::exception& e) {
      Napi::Error::New(info.Env(), e.what()).ThrowAsJavaScriptException();
    }
  }

private:
  Napi::Value Setup(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    try {
      drm_->setup();
    } catch (const std::exception& e) {
      Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
      return env.Undefined();
    }
    renderer_ = std::make_unique<CairoRenderer>(
      drm_->buffer(), drm_->fb_width(), drm_->fb_height(), drm_->stride(), drm_->rotate90());

    Napi::Object result = Napi::Object::New(env);
    result.Set("width",  Napi::Number::New(env, drm_->width()));
    result.Set("height", Napi::Number::New(env, drm_->height()));
    return result;
  }

  Napi::Value Render(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!renderer_)
      Napi::TypeError::New(env, "Call setup() before render()").ThrowAsJavaScriptException();
    if (info.Length() < 1 || !info[0].IsArray())
      Napi::TypeError::New(env, "render() expects an array of draw commands").ThrowAsJavaScriptException();

    renderer_->render(env, info[0].As<Napi::Array>());
    drm_->dirty();
    return env.Undefined();
  }

  Napi::Value Screenshot(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!renderer_) {
      Napi::TypeError::New(env, "Call setup() before screenshot()").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    if (info.Length() < 1 || !info[0].IsString()) {
      Napi::TypeError::New(env, "screenshot(path: string)").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    try {
      renderer_->screenshot(info[0].As<Napi::String>().Utf8Value());
    } catch (const std::exception& e) {
      Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
    }
    return env.Undefined();
  }

  Napi::Value GetWidth(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), drm_->width());
  }

  Napi::Value GetHeight(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), drm_->height());
  }

  Napi::Value Close(const Napi::CallbackInfo& info) {
    renderer_.reset();
    drm_.reset();
    return info.Env().Undefined();
  }

  std::unique_ptr<DrmDevice>    drm_;
  std::unique_ptr<CairoRenderer> renderer_;
};

// USBDEVFS_RESET on a /dev/bus/usb/BBB/DDD node. The Touch Bar firmware puts
// the display interface to sleep when idle; once asleep, every transfer —
// including the SET_CONFIGURATION behind a bConfigurationValue write — fails
// with ETIMEDOUT, and the kernel's own post-failure recovery reset does not
// wake it. Only an explicit device reset does.
Napi::Value UsbReset(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "usbReset(devnode: string)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::string path = info[0].As<Napi::String>().Utf8Value();
  int fd = open(path.c_str(), O_WRONLY);
  if (fd < 0) {
    Napi::Error::New(env, "open " + path + ": " + std::strerror(errno)).ThrowAsJavaScriptException();
    return env.Undefined();
  }
  int rc = ioctl(fd, USBDEVFS_RESET, 0);
  int err = errno;
  close(fd);
  if (rc < 0)
    Napi::Error::New(env, "USBDEVFS_RESET " + path + ": " + std::strerror(err)).ThrowAsJavaScriptException();
  return env.Undefined();
}

Napi::Object InitModule(Napi::Env env, Napi::Object exports) {
  DrmDisplayWrapper::Init(env, exports);
  TouchReader::Init(env, exports);
  KeyInjector::Init(env, exports);
  KeyboardReader::Init(env, exports);
  exports.Set("findKeyboardDevice",  Napi::Function::New(env, FindKeyboardDevice));
  exports.Set("findKeyboardDevices", Napi::Function::New(env, FindKeyboardDevices));
  exports.Set("findPointerDevices",  Napi::Function::New(env, FindPointerDevices));
  exports.Set("findLidDevice",       Napi::Function::New(env, FindLidDevice));
  exports.Set("usbReset",            Napi::Function::New(env, UsbReset));
  return exports;
}

NODE_API_MODULE(drm_backend, InitModule)
