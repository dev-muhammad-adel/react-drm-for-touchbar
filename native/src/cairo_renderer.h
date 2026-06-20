#pragma once
#include <napi.h>
#include <cstdint>
#include <string>
#include <list>
#include <utility>
#include <unordered_map>

struct _cairo_surface; // forward decl — avoids pulling cairo into this header
struct _cairo;         // forward decl for the cairo drawing context

// Measure a line of text via Pango (same shaping as rendering) for the layout
// engine. args: (text, family, size, bold, italic) → { width, height }.
Napi::Value MeasureText(const Napi::CallbackInfo& info);

class CairoRenderer {
public:
  CairoRenderer(uint8_t* buffer, uint32_t fb_w, uint32_t fb_h, uint32_t stride, bool rotate90);
  ~CairoRenderer();

  // Executes a JS array of draw-command objects against the framebuffer.
  void render(Napi::Env env, Napi::Array commands);

  // Binary render path: reads commands from a Float64Array with fixed-stride
  // slots instead of walking JS object properties — eliminates per-property
  // N-API hash lookups for numeric fields.
  void renderBinary(Napi::Env env, Napi::Float32Array data, Napi::Array strings, Napi::Array buffers);


  
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

  // Text bitmap cache: rasterize each unique (text, family, size, color, weight,
  // slant) to its own image surface once, then composite it each frame instead
  // of re-shaping + re-rendering glyphs via cairo_show_text — which the profiler
  // showed dominating the blit. Color is baked in (so it's part of the key);
  // alpha is applied at composite time. Metrics are cached alongside so the
  // alignment/baseline math needs no per-frame text_extents (the shaping step).
  struct TextEntry {
    _cairo_surface* surf;
    double width;      // logical advance width (Pango logical rect)
    double height;     // logical height
    int    baseline;   // Pango baseline in surface pixels
    double pad;        // surface margin baked around the glyphs
    double inkTop;     // ink-rect top, offset from the layout origin (px)
    double inkH;       // ink-rect height — the actual drawn glyph extent (px)
  };
  using TextList = std::list<std::pair<std::string, TextEntry>>;
  TextList text_lru_;
  std::unordered_map<std::string, TextList::iterator> text_index_;
  const TextEntry* textGet(const std::string& key);
  const TextEntry* textPut(const std::string& key, const TextEntry& e);

  // Reused per-renderer surface + context — created once in the constructor,
  // kept alive across frames. Avoids repeated alloc/free overhead and,
  // critically, preserves Cairo's per-context scaled-font cache so font
  // metrics lookups are never cold.
  _cairo_surface* surf_ = nullptr;
  _cairo*         cr_   = nullptr;
};
