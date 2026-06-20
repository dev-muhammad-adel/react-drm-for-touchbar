#include <napi.h>
#include <memory>
#include <cerrno>
#include <cstring>
#include <cstdlib>
#include <cstdio>
#include <chrono>
#include <vector>
#include <algorithm>
#include <cmath>
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
      InstanceMethod("setup",         &DrmDisplayWrapper::Setup),
      InstanceMethod("render",         &DrmDisplayWrapper::Render),
      InstanceMethod("renderBinary",   &DrmDisplayWrapper::RenderBinary),
      InstanceMethod("drawBars",       &DrmDisplayWrapper::DrawBars),
      InstanceMethod("screenshot",     &DrmDisplayWrapper::Screenshot),
      InstanceMethod("getWidth",       &DrmDisplayWrapper::GetWidth),
      InstanceMethod("getHeight",      &DrmDisplayWrapper::GetHeight),
      InstanceMethod("close",          &DrmDisplayWrapper::Close),
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

    // Optional damage clips (info[1]): array of {x,y,w,h} in LOGICAL coords,
    // transformed to FB space (handles the 90° rotation). Absent/empty → whole
    // FB. Opt-in (DISPLAY.partialFlush) — partial flush can desync appletbdrm.
    std::vector<drmModeClip> clips;
    if (info.Length() >= 2 && info[1].IsArray()) {
      Napi::Array arr = info[1].As<Napi::Array>();
      const uint32_t n = arr.Length();
      const int fbw = (int)drm_->fb_width(), fbh = (int)drm_->fb_height();
      const bool rot = drm_->rotate90();
      clips.reserve(n);
      for (uint32_t i = 0; i < n; i++) {
        Napi::Value v = arr.Get(i);
        if (!v.IsObject()) continue;
        Napi::Object o = v.As<Napi::Object>();
        double x = o.Get("x").ToNumber().DoubleValue();
        double y = o.Get("y").ToNumber().DoubleValue();
        double w = o.Get("w").ToNumber().DoubleValue();
        double h = o.Get("h").ToNumber().DoubleValue();
        double lx1 = x - 1, ly1 = y - 1, lx2 = x + w + 1, ly2 = y + h + 1; // 1px AA margin
        int fx1, fy1, fx2, fy2;
        if (rot) { // logical (lx,ly) → fb (fbw - ly, lx)
          fx1 = (int)std::floor(fbw - ly2); fy1 = (int)std::floor(lx1);
          fx2 = (int)std::ceil (fbw - ly1); fy2 = (int)std::ceil (lx2);
        } else {
          fx1 = (int)std::floor(lx1); fy1 = (int)std::floor(ly1);
          fx2 = (int)std::ceil (lx2); fy2 = (int)std::ceil (ly2);
        }
        fx1 = std::max(0, std::min(fx1, fbw)); fx2 = std::max(0, std::min(fx2, fbw));
        fy1 = std::max(0, std::min(fy1, fbh)); fy2 = std::max(0, std::min(fy2, fbh));
        if (fx2 > fx1 && fy2 > fy1)
          clips.push_back(drmModeClip{ (uint16_t)fx1, (uint16_t)fy1, (uint16_t)fx2, (uint16_t)fy2 });
      }
    }
    const drmModeClip* cp = clips.empty() ? nullptr : clips.data();
    const uint32_t cn = (uint32_t)clips.size();

    // Profiler (REACT_DRM_PROFILE=1): time the DRM scanout flush.
    static const bool prof = std::getenv("REACT_DRM_PROFILE") != nullptr;
    if (prof) {
      auto t0 = std::chrono::steady_clock::now();
      drm_->dirty(cp, cn);
      static double acc = 0; static int n = 0;
      acc += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
      if (++n >= 30) { fprintf(stderr, "[native] drm flush avg/frame: %.2fms\n", acc / n); acc = 0; n = 0; }
    } else {
      drm_->dirty(cp, cn);
    }
    return env.Undefined();
  }

  // Draw the audio bars directly into the FB + dirty ONLY a full-height band
  // (contiguous FB rows — the shape appletbdrm accepts). Off the React commit
  // loop, so bar updates don't trigger full-tree layout/serialize.
  Napi::Value RenderBinary(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!renderer_) { Napi::TypeError::New(env, "Call setup() before renderBinary()").ThrowAsJavaScriptException(); return env.Undefined(); }
    if (info.Length() < 3
        || !info[0].IsTypedArray()
        || !info[1].IsArray()
        || !info[2].IsArray()) {
      Napi::TypeError::New(env, "renderBinary(data: Float32Array, strings: string[], buffers: Buffer[], clips?: DamageRect[])").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    renderer_->renderBinary(env,
      info[0].As<Napi::Float32Array>(),
      info[1].As<Napi::Array>(),
      info[2].As<Napi::Array>());

    // Optional damage clips (info[3]) — same logic as Render().
    std::vector<drmModeClip> clips;
    if (info.Length() >= 4 && info[3].IsArray()) {
      Napi::Array arr = info[3].As<Napi::Array>();
      const uint32_t n = arr.Length();
      const int fbw = (int)drm_->fb_width(), fbh = (int)drm_->fb_height();
      const bool rot = drm_->rotate90();
      clips.reserve(n);
      for (uint32_t j = 0; j < n; j++) {
        Napi::Value v = arr.Get(j);
        if (!v.IsObject()) continue;
        Napi::Object o = v.As<Napi::Object>();
        double x = o.Get("x").ToNumber().DoubleValue();
        double y = o.Get("y").ToNumber().DoubleValue();
        double w = o.Get("w").ToNumber().DoubleValue();
        double h = o.Get("h").ToNumber().DoubleValue();
        double lx1=x-1,ly1=y-1,lx2=x+w+1,ly2=y+h+1;
        int fx1,fy1,fx2,fy2;
        if (rot) { fx1=(int)std::floor(fbw-ly2); fy1=(int)std::floor(lx1); fx2=(int)std::ceil(fbw-ly1); fy2=(int)std::ceil(lx2); }
        else     { fx1=(int)std::floor(lx1); fy1=(int)std::floor(ly1); fx2=(int)std::ceil(lx2); fy2=(int)std::ceil(ly2); }
        fx1=std::max(0,std::min(fx1,fbw)); fx2=std::max(0,std::min(fx2,fbw));
        fy1=std::max(0,std::min(fy1,fbh)); fy2=std::max(0,std::min(fy2,fbh));
        if (fx2>fx1 && fy2>fy1) clips.push_back(drmModeClip{(uint16_t)fx1,(uint16_t)fy1,(uint16_t)fx2,(uint16_t)fy2});
      }
    }
    const drmModeClip* cp = clips.empty() ? nullptr : clips.data();
    const uint32_t cn = (uint32_t)clips.size();
    static const bool prof = std::getenv("REACT_DRM_PROFILE") != nullptr;
    if (prof) {
      auto t0 = std::chrono::steady_clock::now();
      drm_->dirty(cp, cn);
      static double acc2=0; static int n2=0;
      acc2 += std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-t0).count();
      if (++n2 >= 30) { fprintf(stderr,"[native] drm flush avg/frame: %.2fms\n",acc2/n2); acc2=0; n2=0; }
    } else {
      drm_->dirty(cp, cn);
    }
    return env.Undefined();
  }

  Napi::Value DrawBars(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!renderer_) { Napi::TypeError::New(env, "Call setup() before drawBars()").ThrowAsJavaScriptException(); return env.Undefined(); }
    if (info.Length() < 1 || !info[0].IsObject()) { Napi::TypeError::New(env, "drawBars(opts)").ThrowAsJavaScriptException(); return env.Undefined(); }
    Napi::Object opts = info[0].As<Napi::Object>();
    renderer_->drawBars(env, opts);

    // Full-height band over the bars' x-extent → contiguous FB rows after rotation.
    const double x0 = opts.Get("x0").ToNumber().DoubleValue();
    const double barW = opts.Get("barW").ToNumber().DoubleValue();
    const double gap = opts.Get("gap").ToNumber().DoubleValue();
    const double fullH = opts.Get("fullHeight").ToNumber().DoubleValue();
    const uint32_t n = opts.Get("heights").As<Napi::Array>().Length();
    const double bandW = n ? n * barW + (n - 1) * gap : 0;
    const int fbw = (int)drm_->fb_width(), fbh = (int)drm_->fb_height();
    const bool rot = drm_->rotate90();
    double lx1 = x0 - 1, ly1 = -1, lx2 = x0 + bandW + 1, ly2 = fullH + 1;
    int fx1, fy1, fx2, fy2;
    if (rot) { fx1 = (int)std::floor(fbw - ly2); fy1 = (int)std::floor(lx1); fx2 = (int)std::ceil(fbw - ly1); fy2 = (int)std::ceil(lx2); }
    else     { fx1 = (int)std::floor(lx1); fy1 = (int)std::floor(ly1); fx2 = (int)std::ceil(lx2); fy2 = (int)std::ceil(ly2); }
    fx1 = std::max(0, std::min(fx1, fbw)); fx2 = std::max(0, std::min(fx2, fbw));
    fy1 = std::max(0, std::min(fy1, fbh)); fy2 = std::max(0, std::min(fy2, fbh));
    if (fx2 > fx1 && fy2 > fy1) {
      drmModeClip c{ (uint16_t)fx1, (uint16_t)fy1, (uint16_t)fx2, (uint16_t)fy2 };
      drm_->dirty(&c, 1);
    }
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
  exports.Set("measureText",         Napi::Function::New(env, MeasureText));
  exports.Set("findKeyboardDevice",  Napi::Function::New(env, FindKeyboardDevice));
  exports.Set("findKeyboardDevices", Napi::Function::New(env, FindKeyboardDevices));
  exports.Set("findPointerDevices",  Napi::Function::New(env, FindPointerDevices));
  exports.Set("findLidDevice",       Napi::Function::New(env, FindLidDevice));
  exports.Set("usbReset",            Napi::Function::New(env, UsbReset));
  return exports;
}

NODE_API_MODULE(drm_backend, InitModule)
