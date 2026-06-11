#pragma once
#include <napi.h>
#include <cstdint>
#include <string>

class CairoRenderer {
public:
  CairoRenderer(uint8_t* buffer, uint32_t fb_w, uint32_t fb_h, uint32_t stride, bool rotate90);

  // Executes a JS array of draw-command objects against the framebuffer.
  void render(Napi::Env env, Napi::Array commands);

  // Writes the current framebuffer to a PNG file, in logical orientation
  // (un-rotated when the panel scans out 90°).
  void screenshot(const std::string& path);

private:
  uint8_t*  buf_;
  uint32_t  fb_w_;
  uint32_t  fb_h_;
  uint32_t  stride_;
  bool      rotate90_;
};
