#pragma once
#include <napi.h>
#include <cstdint>
#include <string>
#include <list>
#include <utility>
#include <unordered_map>

struct _cairo_surface; // forward decl — avoids pulling cairo into this header

class CairoRenderer {
public:
  CairoRenderer(uint8_t* buffer, uint32_t fb_w, uint32_t fb_h, uint32_t stride, bool rotate90);
  ~CairoRenderer();

  // Executes a JS array of draw-command objects against the framebuffer.
  void render(Napi::Env env, Napi::Array commands);


  
  void drawBars(Napi::Env env, const Napi::Object& opts);

  // Writes the current framebuffer to a PNG file, in logical orientation
  // (un-rotated when the panel scans out 90°).
  void screenshot(const std::string& path);

private:
  uint8_t*  buf_;
  uint32_t  fb_w_;
  uint32_t  fb_h_;
  uint32_t  stride_;
  bool      rotate90_;

  // SVG bitmap cache: rasterize each unique (src, size) to an image surface
  // once, then just composite it each frame. Without it, every draw_svg
  // re-parses AND re-rasterizes via librsvg (~0.3ms/icon) every frame. Bounded
  // LRU keyed on src+size; static icons stay hot, changing-src SVGs (pomodoro
  // ring) churn the LRU tail without unbounded growth.
  using SvgList = std::list<std::pair<std::string, _cairo_surface*>>;
  SvgList svg_lru_;                                       // front = most recently used
  std::unordered_map<std::string, SvgList::iterator> svg_index_;
  _cairo_surface* svgGet(const std::string& key);
  void svgPut(const std::string& key, _cairo_surface* surf);
};
