#include "cairo_renderer.h"
#include <cairo/cairo.h>
#include <librsvg/rsvg.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <cstdlib>
#include <chrono>
#include <cstdio>
#include <stdexcept>
#include <string>
#include <vector>

// Native blit profiler (REACT_DRM_PROFILE=1). Splits CairoRenderer::render into
// per-command-type buckets (text vs shapes vs svg vs image) and prints a periodic
// summary, so the blit cost can be attributed. Off by default; kept as a standing
// diagnostic tool (pairs with the JS [profile] line and the drm-flush timing in
// binding.cpp).
namespace {
  const bool kBlitProf = std::getenv("REACT_DRM_PROFILE") != nullptr;
  double pShape = 0, pText = 0, pSvg = 0, pImage = 0, pOther = 0, pTotal = 0;
  int    pFrames = 0;
  using Clock = std::chrono::steady_clock;
  inline double msSince(Clock::time_point t) {
    return std::chrono::duration<double, std::milli>(Clock::now() - t).count();
  }
  // RAII: adds the scope's elapsed ms to a bucket (covers all `continue` paths).
  struct Acc { double& a; Clock::time_point t0; Acc(double& x) : a(x), t0(Clock::now()) {} ~Acc() { a += msSince(t0); } };
}

// Per-corner rounded rect: tl=top-left, tr=top-right, br=bottom-right, bl=bottom-left
static void rounded_rect(cairo_t* cr, double x, double y, double w, double h,
                          double tl, double tr, double br, double bl) {
  double maxR = fmin(w / 2.0, h / 2.0);
  tl = fmin(fmax(tl, 0.0), maxR);
  tr = fmin(fmax(tr, 0.0), maxR);
  br = fmin(fmax(br, 0.0), maxR);
  bl = fmin(fmax(bl, 0.0), maxR);

  cairo_move_to(cr, x + tl, y);
  cairo_line_to(cr, x + w - tr, y);
  if (tr > 0) cairo_arc(cr, x + w - tr, y + tr,     tr, -M_PI / 2, 0);
  cairo_line_to(cr, x + w, y + h - br);
  if (br > 0) cairo_arc(cr, x + w - br, y + h - br, br,  0,        M_PI / 2);
  cairo_line_to(cr, x + bl, y + h);
  if (bl > 0) cairo_arc(cr, x + bl,     y + h - bl, bl,  M_PI / 2, M_PI);
  cairo_line_to(cr, x, y + tl);
  if (tl > 0) cairo_arc(cr, x + tl,     y + tl,     tl,  M_PI,     3 * M_PI / 2);
  cairo_close_path(cr);
}

// Separable box blur on an A8 surface (O(w*h) regardless of radius).
// Two passes (H then V) approximate a Gaussian well enough for shadows.
static void box_blur_h(const uint8_t* src, uint8_t* dst, int w, int h, int stride, int r) {
  for (int y = 0; y < h; y++) {
    const uint8_t* s = src + y * stride;
    uint8_t*       d = dst + y * stride;
    int sum = 0, ksize = 2 * r + 1;
    for (int k = -r; k <= r; k++) sum += s[std::max(0, std::min(k, w - 1))];
    for (int x = 0; x < w; x++) {
      d[x] = (uint8_t)(sum / ksize);
      sum -= s[std::max(0, x - r)];
      sum += s[std::min(w - 1, x + r + 1)];
    }
  }
}

static void box_blur_v(const uint8_t* src, uint8_t* dst, int w, int h, int stride, int r) {
  for (int x = 0; x < w; x++) {
    int sum = 0, ksize = 2 * r + 1;
    for (int k = -r; k <= r; k++) sum += src[std::max(0, std::min(k, h - 1)) * stride + x];
    for (int y = 0; y < h; y++) {
      dst[y * stride + x] = (uint8_t)(sum / ksize);
      sum -= src[std::max(0, y - r) * stride + x];
      sum += src[std::min(h - 1, y + r + 1) * stride + x];
    }
  }
}

static void blur_a8(uint8_t* data, int w, int h, int stride, int r) {
  if (r <= 0) return;
  std::vector<uint8_t> tmp((size_t)h * stride);
  // Two box-blur passes (H+V each) closely approximates a Gaussian.
  box_blur_h(data,      tmp.data(), w, h, stride, r);
  box_blur_v(tmp.data(), data,      w, h, stride, r);
  box_blur_h(data,      tmp.data(), w, h, stride, r);
  box_blur_v(tmp.data(), data,      w, h, stride, r);
}

static void draw_shadow(cairo_t* cr,
                        double x, double y, double w, double h,
                        double tl, double tr, double br, double bl,
                        double dx, double dy, double blur,
                        double sr, double sg, double sb, double sa,
                        bool inset) {
  if (sa <= 0 || w <= 0 || h <= 0) return;
  int pad = (int)std::ceil(blur);
  if (inset && pad < 1) pad = 1; // inset needs a border to blur inward from
  int sw  = (int)std::ceil(w) + 2 * pad;
  int sh  = (int)std::ceil(h) + 2 * pad;

  cairo_surface_t* surf = cairo_image_surface_create(CAIRO_FORMAT_A8, sw, sh);
  cairo_t* scr = cairo_create(surf);
  if (!inset) {
    // Outer drop shadow: a blurred filled copy of the shape.
    rounded_rect(scr, pad, pad, w, h, tl, tr, br, bl);
    cairo_set_source_rgba(scr, 0, 0, 0, 1);
    cairo_fill(scr);
  } else {
    // Inner shadow: opaque everywhere EXCEPT the (offset) shape; after the blur
    // the soft opaque→hole edge lands just inside the box edges. With dx/dy the
    // hole shifts, darkening the opposite inner edge (CSS `inset` semantics).
    cairo_set_source_rgba(scr, 0, 0, 0, 1);
    cairo_paint(scr);
    rounded_rect(scr, pad + dx, pad + dy, w, h, tl, tr, br, bl);
    cairo_set_operator(scr, CAIRO_OPERATOR_CLEAR);
    cairo_fill(scr);
  }
  cairo_destroy(scr);
  cairo_surface_flush(surf);

  uint8_t* data   = cairo_image_surface_get_data(surf);
  int      stride = cairo_image_surface_get_stride(surf);
  blur_a8(data, sw, sh, stride, pad);
  cairo_surface_mark_dirty(surf);

  cairo_save(cr);
  cairo_set_source_rgba(cr, sr, sg, sb, sa);
  if (!inset) {
    cairo_mask_surface(cr, surf, x + dx - pad, y + dy - pad);
  } else {
    // Clip to the box so the inner shadow only paints inside it.
    rounded_rect(cr, x, y, w, h, tl, tr, br, bl);
    cairo_clip(cr);
    cairo_mask_surface(cr, surf, x - pad, y - pad);
  }
  cairo_restore(cr);

  cairo_surface_destroy(surf);
}

CairoRenderer::CairoRenderer(uint8_t* buf, uint32_t fb_w, uint32_t fb_h, uint32_t stride, bool rotate90)
  : buf_(buf), fb_w_(fb_w), fb_h_(fb_h), stride_(stride), rotate90_(rotate90)
{
  // Create the framebuffer surface and drawing context once — reused every
  // frame to avoid per-call alloc/free overhead and to keep Cairo's internal
  // scaled-font cache warm across frames.
  surf_ = cairo_image_surface_create_for_data(
    buf_, CAIRO_FORMAT_ARGB32, (int)fb_w_, (int)fb_h_, (int)stride_);
  if (cairo_surface_status(surf_) != CAIRO_STATUS_SUCCESS) {
    cairo_surface_destroy(surf_); surf_ = nullptr;
    throw std::runtime_error("CairoRenderer: failed to create framebuffer surface");
  }
  cr_ = cairo_create(surf_);
  if (cairo_status(cr_) != CAIRO_STATUS_SUCCESS) {
    cairo_destroy(cr_); cr_ = nullptr;
    cairo_surface_destroy(surf_); surf_ = nullptr;
    throw std::runtime_error("CairoRenderer: failed to create cairo context");
  }
}

CairoRenderer::~CairoRenderer() {
  for (auto& entry : svg_lru_)  cairo_surface_destroy(entry.second);
  for (auto& entry : text_lru_) cairo_surface_destroy(entry.second.surf);
  if (cr_)   { cairo_destroy(cr_);              cr_   = nullptr; }
  if (surf_) { cairo_surface_destroy(surf_);    surf_ = nullptr; }
}

// SVG bitmap cache (bounded LRU). Cap is generous — icons/glyphs number in the
// low tens; changing-src SVGs evict the least-recently-used entry.
static constexpr size_t kSvgCacheMax = 64;

cairo_surface_t* CairoRenderer::svgGet(const std::string& key) {
  auto it = svg_index_.find(key);
  if (it == svg_index_.end()) return nullptr;
  svg_lru_.splice(svg_lru_.begin(), svg_lru_, it->second); // promote to MRU
  return it->second->second;
}

void CairoRenderer::svgPut(const std::string& key, cairo_surface_t* surf) {
  svg_lru_.emplace_front(key, surf);
  svg_index_[key] = svg_lru_.begin();
  if (svg_lru_.size() > kSvgCacheMax) {
    auto& victim = svg_lru_.back();
    cairo_surface_destroy(victim.second);
    svg_index_.erase(victim.first);
    svg_lru_.pop_back();
  }
}

// Text bitmap cache. Strings/labels number in the low hundreds across layers;
// the cap is generous and the LRU tail evicts stale entries (changing values
// like the clock / cpu% churn through without unbounded growth).
static constexpr size_t kTextCacheMax = 256;

const CairoRenderer::TextEntry* CairoRenderer::textGet(const std::string& key) {
  auto it = text_index_.find(key);
  if (it == text_index_.end()) return nullptr;
  text_lru_.splice(text_lru_.begin(), text_lru_, it->second); // promote to MRU
  return &it->second->second;
}

const CairoRenderer::TextEntry* CairoRenderer::textPut(const std::string& key, const TextEntry& e) {
  text_lru_.emplace_front(key, e);
  text_index_[key] = text_lru_.begin();
  if (text_lru_.size() > kTextCacheMax) {
    auto& victim = text_lru_.back();
    cairo_surface_destroy(victim.second.surf);
    text_index_.erase(victim.first);
    text_lru_.pop_back();
  }
  return &text_lru_.begin()->second;
}

// Helper: safely read a number property from a JS object.
static double numProp(const Napi::Object& obj, const char* key) {
  auto val = obj.Get(key);
  if (!val.IsNumber()) return 0.0;
  return val.As<Napi::Number>().DoubleValue();
}

static std::string strProp(const Napi::Object& obj, const char* key) {
  auto val = obj.Get(key);
  if (!val.IsString()) return "";
  return val.As<Napi::String>().Utf8Value();
}


void CairoRenderer::drawBars(Napi::Env env, const Napi::Object& opts) {
  (void)env;
  if (!surf_ || !cr_) return;
  cairo_t* cr = cr_;

  // Reset per-call state so drawBars and render() don't interfere.
  cairo_reset_clip(cr);
  cairo_new_path(cr);
  if (rotate90_) {
    cairo_matrix_t m;
    m.xx = 0; m.xy = -1; m.x0 = (double)fb_w_;
    m.yx = 1; m.yy = 0;  m.y0 = 0;
    cairo_set_matrix(cr, &m);
  } else {
    cairo_identity_matrix(cr);
  }

  const double x0 = numProp(opts, "x0"), baseY = numProp(opts, "baseY");
  const double barW = numProp(opts, "barW"), gap = numProp(opts, "gap");
  const double fullH = numProp(opts, "fullHeight");
  Napi::Array heights = opts.Get("heights").As<Napi::Array>();
  Napi::Array colors  = opts.Get("colors").As<Napi::Array>();
  Napi::Array bg      = opts.Get("bg").As<Napi::Array>();
  const uint32_t n = heights.Length();
  const double bandW = n ? n * barW + (n - 1) * gap : 0;

  // Clear the bars band (full height → contiguous FB rows after rotation).
  cairo_set_source_rgb(cr,
    bg.Get((uint32_t)0).ToNumber().DoubleValue(),
    bg.Get((uint32_t)1).ToNumber().DoubleValue(),
    bg.Get((uint32_t)2).ToNumber().DoubleValue());
  cairo_rectangle(cr, x0, 0, bandW, fullH);
  cairo_fill(cr);

  for (uint32_t i = 0; i < n; i++) {
    const double h = heights.Get(i).ToNumber().DoubleValue();
    if (h <= 0) continue;
    cairo_set_source_rgb(cr,
      colors.Get(i * 3).ToNumber().DoubleValue(),
      colors.Get(i * 3 + 1).ToNumber().DoubleValue(),
      colors.Get(i * 3 + 2).ToNumber().DoubleValue());
    cairo_rectangle(cr, x0 + i * (barW + gap), baseY - h, barW, h);
    cairo_fill(cr);
  }

  cairo_surface_flush(surf_);
}

void CairoRenderer::render(Napi::Env env, Napi::Array commands) {
  // Cairo ARGB32 maps directly to DRM XRGB8888 on little-endian:
  // both store pixels as [B, G, R, _] in memory.
  if (!surf_ || !cr_) throw std::runtime_error("CairoRenderer: not initialized");
  cairo_t* cr = cr_;

  // Reset per-frame mutable state: clips pushed by clip_push, any stray path
  // segments, and the CTM (which clip_push/pop saves/restores via cairo_save —
  // a mismatch would accumulate; resetting here makes every frame self-contained).
  cairo_reset_clip(cr);
  cairo_new_path(cr);
  if (rotate90_) {
    cairo_matrix_t m;
    m.xx = 0;  m.xy = -1; m.x0 = (double)fb_w_;
    m.yx = 1;  m.yy = 0;  m.y0 = 0;
    cairo_set_matrix(cr, &m);
  } else {
    cairo_identity_matrix(cr);
  }

  Clock::time_point _renderT0 = kBlitProf ? Clock::now() : Clock::time_point{};

  uint32_t len = commands.Length();
  for (uint32_t i = 0; i < len; ++i) {
    if (!commands.Get(i).IsObject()) continue;
    Napi::Object cmd = commands.Get(i).As<Napi::Object>();
    std::string type = strProp(cmd, "cmd");

    double* _bucket = &pOther;
    if      (type == "text")       _bucket = &pText;
    else if (type == "draw_svg")   _bucket = &pSvg;
    else if (type == "draw_image") _bucket = &pImage;
    else                           _bucket = &pShape; // fill/stroke/shadow/clip/clear/overlay
    Acc _acc(*_bucket); // times this command (incl. NAPI prop reads) into its bucket

    if (type == "clear") {
      const double r = numProp(cmd, "r");
      const double g = numProp(cmd, "g");
      const double b = numProp(cmd, "b");
      cairo_set_source_rgb(cr, r, g, b);
      cairo_paint(cr);

    } else if (type == "shadow") {
      double x = numProp(cmd, "x"), y = numProp(cmd, "y");
      double w = numProp(cmd, "w"), h = numProp(cmd, "h");
      double tl = numProp(cmd, "tl"), tr = numProp(cmd, "tr");
      double br = numProp(cmd, "br"), bl = numProp(cmd, "bl");
      double r  = numProp(cmd, "r"), g = numProp(cmd, "g"), b = numProp(cmd, "b");
      double a  = numProp(cmd, "a");
      double dx = numProp(cmd, "dx"), dy = numProp(cmd, "dy"), blur = numProp(cmd, "blur");
      auto iv = cmd.Get("inset");
      bool inset = (iv.IsBoolean() && iv.As<Napi::Boolean>().Value())
                 || (iv.IsNumber()  && iv.As<Napi::Number>().DoubleValue() != 0.0);
      draw_shadow(cr, x, y, w, h, tl, tr, br, bl,
                  dx, dy, blur,
                  r, g, b, a, inset);

    } else if (type == "fill_rect") {
      double x = numProp(cmd, "x"), y = numProp(cmd, "y");
      double w = numProp(cmd, "w"), h = numProp(cmd, "h");
      double a = numProp(cmd, "a"); if (a <= 0) a = 1.0;
      double r = numProp(cmd, "r"), g = numProp(cmd, "g"), b = numProp(cmd, "b");
      double tl = numProp(cmd, "tl"), tr = numProp(cmd, "tr");
      double br = numProp(cmd, "br"), bl = numProp(cmd, "bl");
      cairo_set_source_rgba(cr, r, g, b, a);
      rounded_rect(cr, x, y, w, h, tl, tr, br, bl);
      cairo_fill(cr);

    } else if (type == "stroke_rect") {
      double x = numProp(cmd, "x"), y = numProp(cmd, "y");
      double w = numProp(cmd, "w"), h = numProp(cmd, "h");
      double a = numProp(cmd, "a"); if (a <= 0) a = 1.0;
      double r = numProp(cmd, "r"), g = numProp(cmd, "g"), b = numProp(cmd, "b");
      double lw = numProp(cmd, "lineWidth");
      double tl = numProp(cmd, "tl"), tr = numProp(cmd, "tr");
      double br = numProp(cmd, "br"), bl = numProp(cmd, "bl");
      std::string bstyle = strProp(cmd, "borderStyle");
      // Inset by lw/2 so the stroke stays fully inside the rect bounds.
      double ins = lw / 2.0;
      cairo_set_source_rgba(cr, r, g, b, a);
      cairo_set_line_width(cr, lw);
      if (bstyle == "dashed") {
        double d[] = { lw * 4, lw * 2 };
        cairo_set_dash(cr, d, 2, 0);
      } else if (bstyle == "dotted") {
        double d[] = { lw, lw * 2 };
        cairo_set_dash(cr, d, 2, 0);
      } else {
        cairo_set_dash(cr, nullptr, 0, 0);
      }
      rounded_rect(cr, x + ins, y + ins, w - 2*ins, h - 2*ins,
                   fmax(0.0, tl - ins), fmax(0.0, tr - ins),
                   fmax(0.0, br - ins), fmax(0.0, bl - ins));
      cairo_stroke(cr);
      cairo_set_dash(cr, nullptr, 0, 0);

    } else if (type == "clip_push") {
      double x = numProp(cmd, "x"), y = numProp(cmd, "y");
      double w = numProp(cmd, "w"), h = numProp(cmd, "h");
      double tl = numProp(cmd, "tl"), tr = numProp(cmd, "tr");
      double br = numProp(cmd, "br"), bl = numProp(cmd, "bl");
      cairo_save(cr);
      rounded_rect(cr, x, y, w, h, tl, tr, br, bl);
      cairo_clip(cr);

    } else if (type == "clip_pop") {
      cairo_restore(cr);

    } else if (type == "text") {
      double x    = numProp(cmd, "x");
      double y    = numProp(cmd, "y");
      double size = numProp(cmd, "size");
      double a    = numProp(cmd, "a"); if (a <= 0) a = 1.0;
      double r    = numProp(cmd, "r");
      double g    = numProp(cmd, "g");
      double b    = numProp(cmd, "b");
      std::string family = strProp(cmd, "family");
      std::string text   = strProp(cmd, "text");
      bool bold   = cmd.Get("bold").ToBoolean().Value();
      bool italic = cmd.Get("italic").ToBoolean().Value();

      std::string align  = strProp(cmd, "align");
      double containerX  = numProp(cmd, "containerX");
      double containerW  = numProp(cmd, "containerW");
      double lineH = numProp(cmd, "lineHeight");

      cairo_set_source_rgba(cr, r, g, b, a);
      cairo_select_font_face(cr, family.c_str(),
                             italic ? CAIRO_FONT_SLANT_ITALIC : CAIRO_FONT_SLANT_NORMAL,
                             bold   ? CAIRO_FONT_WEIGHT_BOLD  : CAIRO_FONT_WEIGHT_NORMAL);
      cairo_set_font_size(cr, size);

      double drawX = x;
      if (containerW > 0 && align != "left") {
        cairo_text_extents_t te;
        cairo_text_extents(cr, text.c_str(), &te);
        if (align == "center")
          drawX = containerX + (containerW - te.width) / 2.0 - te.x_bearing;
        else if (align == "right")
          drawX = containerX + containerW - te.width - te.x_bearing;
      }

      cairo_font_extents_t fe;
      cairo_font_extents(cr, &fe);
      // With lineHeight: center text vertically within the line box.
      // Without: y is the top of the text bounding box (ascent offset only).
      double drawY = (lineH > 0)
        ? y + (lineH - (fe.ascent + fe.descent)) / 2.0 + fe.ascent
        : y + fe.ascent;
      cairo_move_to(cr, drawX, drawY);
      cairo_show_text(cr, text.c_str());
    } else if (type == "overlay") {
      // Semi-transparent black veil — used for screen-saver dim step.
      const double a = numProp(cmd, "a");
      cairo_set_source_rgba(cr, 0.0, 0.0, 0.0, a);
      cairo_paint(cr);

    } else if (type == "draw_svg") {
      double x = numProp(cmd, "x"), y = numProp(cmd, "y");
      double w = numProp(cmd, "w"), h = numProp(cmd, "h");
      std::string src = strProp(cmd, "src");
      if (src.empty()) continue;

      int iw = (int)lround(w), ih = (int)lround(h);
      if (iw <= 0 || ih <= 0) continue;
      // Don't cache very large surfaces (e.g. full-bar SVGs) — bound memory and
      // avoid expensive one-off bitmaps; those render directly.
      const bool cacheable = (long)iw * ih <= 512 * 256;
      const std::string key = cacheable
        ? src + '|' + std::to_string(iw) + 'x' + std::to_string(ih) : std::string();

      cairo_surface_t* bmp = cacheable ? svgGet(key) : nullptr;
      if (!bmp) {
        GError *gerr = nullptr;
        RsvgHandle *handle = (src[0] == '<')
          ? rsvg_handle_new_from_data(reinterpret_cast<const guint8*>(src.data()),
                                      static_cast<gsize>(src.size()), &gerr)
          : rsvg_handle_new_from_file(src.c_str(), &gerr);
        if (!handle) { if (gerr) g_error_free(gerr); continue; }

        if (cacheable) {
          // Rasterize once into an offscreen surface at integer size; future
          // frames just composite it.
          bmp = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, iw, ih);
          cairo_t* bcr = cairo_create(bmp);
          RsvgRectangle vp = { 0, 0, (double)iw, (double)ih };
          GError *rerr = nullptr;
          rsvg_handle_render_document(handle, bcr, &vp, &rerr);
          if (rerr) g_error_free(rerr);
          cairo_destroy(bcr);
          g_object_unref(handle);
          svgPut(key, bmp); // cache owns the surface (destroyed on evict / dtor)
        } else {
          // Uncacheable: render straight to the framebuffer, no caching.
          cairo_save(cr);
          RsvgRectangle vp = { x, y, w, h };
          GError *rerr = nullptr;
          rsvg_handle_render_document(handle, cr, &vp, &rerr);
          if (rerr) g_error_free(rerr);
          cairo_restore(cr);
          g_object_unref(handle);
          continue;
        }
      }

      // Composite the cached bitmap at (x, y). The active transform (incl. the
      // rotate90 scanout matrix) applies to the composite just as it would to a
      // direct render.
      cairo_save(cr);
      cairo_set_source_surface(cr, bmp, x, y);
      cairo_paint(cr);
      cairo_restore(cr);

    } else if (type == "draw_image") {
      // Raw pixels (premultiplied ARGB32 / BGRA on little-endian) scaled into
      // a destination box with rounded-corner clipping. The buffer is borrowed,
      // not copied — it stays alive as a command arg for this synchronous call.
      double x = numProp(cmd, "x"), y = numProp(cmd, "y");
      double w = numProp(cmd, "w"), h = numProp(cmd, "h");
      int sw = (int)numProp(cmd, "sw");
      int sh = (int)numProp(cmd, "sh");
      double tl = numProp(cmd, "tl"), tr = numProp(cmd, "tr");
      double br = numProp(cmd, "br"), bl = numProp(cmd, "bl");
      if (sw <= 0 || sh <= 0 || w <= 0 || h <= 0) continue;

      auto dataVal = cmd.Get("data");
      if (!dataVal.IsBuffer()) continue;
      Napi::Buffer<uint8_t> data = dataVal.As<Napi::Buffer<uint8_t>>();
      int stride = cairo_format_stride_for_width(CAIRO_FORMAT_ARGB32, sw);
      if (data.Length() < (size_t)(stride * sh)) continue;

      cairo_surface_t* img = cairo_image_surface_create_for_data(
        data.Data(), CAIRO_FORMAT_ARGB32, sw, sh, stride);
      if (cairo_surface_status(img) != CAIRO_STATUS_SUCCESS) {
        cairo_surface_destroy(img);
        continue;
      }

      cairo_save(cr);
      rounded_rect(cr, x, y, w, h, tl, tr, br, bl);
      cairo_clip(cr);
      cairo_translate(cr, x, y);
      cairo_scale(cr, w / (double)sw, h / (double)sh);
      cairo_set_source_surface(cr, img, 0, 0);
      cairo_pattern_set_filter(cairo_get_source(cr), CAIRO_FILTER_GOOD);
      cairo_paint(cr);
      cairo_restore(cr);
      cairo_surface_destroy(img);

    }
    // Unknown commands are silently skipped.
  }

  // Flush ensures Cairo finalises all pending draws into buf_ before the DRM
  // driver DMAs the framebuffer. Surface and context are kept alive for reuse.
  cairo_surface_flush(surf_);

  if (kBlitProf) {
    pTotal += msSince(_renderT0);
    if (++pFrames >= 30) {
      fprintf(stderr,
        "[native] render avg/frame: total=%.2fms | shapes=%.2f text=%.2f svg=%.2f image=%.2f other=%.2f (ms)\n",
        pTotal / pFrames, pShape / pFrames, pText / pFrames, pSvg / pFrames, pImage / pFrames, pOther / pFrames);
      pTotal = pShape = pText = pSvg = pImage = pOther = 0;
      pFrames = 0;
    }
  }
}

// ── Binary render path ────────────────────────────────────────────────────────
// Reads commands from a Float64Array with STRIDE=22 words per slot instead of
// walking JS object properties. Eliminates per-property N-API hash lookups for
// all numeric fields; strings/buffers are still accessed via Napi::Array but
// only for commands that actually carry them (text, svg, image).
//
// Field layout: see BINARY_STRIDE / CMD_TYPE constants in serialize.ts.
//  [0]     cmd_type
//  [1..16] numeric fields (command-dependent)
//  [17]    str0_idx   (-1 = none)
//  [18]    str1_idx
//  [19]    str2_idx
//  [20]    buf_idx    (-1 = none)
//  [21]    reserved

static constexpr int BSTRIDE = 22;
enum CmdType { CT_CLEAR=0, CT_FILL=1, CT_STROKE=2, CT_SHADOW=3,
               CT_CLIP_PUSH=4, CT_CLIP_POP=5, CT_TEXT=6,
               CT_DRAW_SVG=7, CT_DRAW_IMAGE=8, CT_OVERLAY=9 };

void CairoRenderer::renderBinary(Napi::Env env, Napi::Float32Array data,
                                  Napi::Array strings, Napi::Array buffers) {
  (void)env;
  if (!surf_ || !cr_) throw std::runtime_error("CairoRenderer: not initialized");
  cairo_t* cr = cr_;

  cairo_reset_clip(cr);
  cairo_new_path(cr);
  if (rotate90_) {
    cairo_matrix_t m;
    m.xx = 0;  m.xy = -1; m.x0 = (double)fb_w_;
    m.yx = 1;  m.yy = 0;  m.y0 = 0;
    cairo_set_matrix(cr, &m);
  } else {
    cairo_identity_matrix(cr);
  }

  Clock::time_point _renderT0 = kBlitProf ? Clock::now() : Clock::time_point{};

  const float*   D   = data.Data();
  const uint32_t len = (uint32_t)(data.ElementLength() / BSTRIDE);

  // Helper: read a string from the JS string array by index stored in the data.
  auto getStr = [&](int idx) -> std::string {
    if (idx < 0) return "";
    return strings.Get((uint32_t)idx).As<Napi::String>().Utf8Value();
  };

  for (uint32_t i = 0; i < len; ++i) {
    const float* c = D + (size_t)i * BSTRIDE;
    int type = (int)c[0];

    double* _bucket = &pOther;
    if      (type == CT_TEXT)      _bucket = &pText;
    else if (type == CT_DRAW_SVG)  _bucket = &pSvg;
    else if (type == CT_DRAW_IMAGE)_bucket = &pImage;
    else                           _bucket = &pShape;
    Acc _acc(*_bucket);

    if (type == CT_CLEAR) {
      cairo_set_source_rgb(cr, c[1], c[2], c[3]);
      cairo_paint(cr);

    } else if (type == CT_OVERLAY) {
      cairo_set_source_rgba(cr, 0.0, 0.0, 0.0, c[1]);
      cairo_paint(cr);

    } else if (type == CT_CLIP_POP) {
      cairo_restore(cr);

    } else if (type == CT_CLIP_PUSH) {
      cairo_save(cr);
      rounded_rect(cr, c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8]);
      cairo_clip(cr);

    } else if (type == CT_FILL) {
      double a = c[8]; if (a <= 0) a = 1.0;
      cairo_set_source_rgba(cr, c[5], c[6], c[7], a);
      rounded_rect(cr, c[1], c[2], c[3], c[4], c[9], c[10], c[11], c[12]);
      cairo_fill(cr);

    } else if (type == CT_STROKE) {
      double a = c[8]; if (a <= 0) a = 1.0;
      double lw = c[13];
      cairo_set_source_rgba(cr, c[5], c[6], c[7], a);
      cairo_set_line_width(cr, lw);
      std::string bstyle = getStr((int)c[17]);
      if (bstyle == "dashed") {
        double d[] = { lw * 4, lw * 2 }; cairo_set_dash(cr, d, 2, 0);
      } else if (bstyle == "dotted") {
        double d[] = { lw, lw * 2 }; cairo_set_dash(cr, d, 2, 0);
      } else {
        cairo_set_dash(cr, nullptr, 0, 0);
      }
      double ins = lw / 2.0;
      rounded_rect(cr, c[1]+ins, c[2]+ins, c[3]-2*ins, c[4]-2*ins,
                   fmax(0.0,c[9]-ins), fmax(0.0,c[10]-ins),
                   fmax(0.0,c[11]-ins), fmax(0.0,c[12]-ins));
      cairo_stroke(cr);
      cairo_set_dash(cr, nullptr, 0, 0);

    } else if (type == CT_SHADOW) {
      draw_shadow(cr, c[1], c[2], c[3], c[4],
                  c[5], c[6], c[7], c[8],    // tl,tr,br,bl
                  c[13], c[14], c[15],        // dx,dy,blur
                  c[9], c[10], c[11], c[12],  // r,g,b,a
                  c[16] != 0.0f);             // inset

    } else if (type == CT_TEXT) {
      double a = c[6]; if (a <= 0) a = 1.0;
      std::string family = getStr((int)c[17]);
      std::string text   = getStr((int)c[18]);
      if (text.empty()) continue;
      std::string align  = getStr((int)c[19]);
      const bool bold   = (c[11] != 0.0f);
      const bool italic = (c[12] != 0.0f);
      const double size = c[7];
      const double r = c[3], g = c[4], b = c[5];

      // Cache key: everything that affects the rasterized, color-baked glyphs.
      // (Alpha is applied at composite time, so it's deliberately excluded.)
      char hbuf[96];
      snprintf(hbuf, sizeof(hbuf), "%.2f|%d%d|%.4f,%.4f,%.4f|",
               size, bold ? 1 : 0, italic ? 1 : 0, r, g, b);
      std::string key = hbuf; key += family; key += '\x1f'; key += text;

      const TextEntry* e = textGet(key);
      if (!e) {
        // Miss: shape + rasterize once into a dedicated surface, then cache it.
        cairo_select_font_face(cr, family.c_str(),
          italic ? CAIRO_FONT_SLANT_ITALIC : CAIRO_FONT_SLANT_NORMAL,
          bold   ? CAIRO_FONT_WEIGHT_BOLD  : CAIRO_FONT_WEIGHT_NORMAL);
        cairo_set_font_size(cr, size);
        cairo_text_extents_t te; cairo_text_extents(cr, text.c_str(), &te);
        cairo_font_extents_t fe; cairo_font_extents(cr, &fe);
        const double pad = 2.0;
        const int W = (int)ceil(te.width + 2 * pad + 1);
        const int H = (int)ceil(fe.ascent + fe.descent + 2 * pad);
        if (W > 0 && H > 0 && (long)W * H <= 2048 * 256) {
          cairo_surface_t* ts = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, W, H);
          cairo_t* tcr = cairo_create(ts);
          cairo_select_font_face(tcr, family.c_str(),
            italic ? CAIRO_FONT_SLANT_ITALIC : CAIRO_FONT_SLANT_NORMAL,
            bold   ? CAIRO_FONT_WEIGHT_BOLD  : CAIRO_FONT_WEIGHT_NORMAL);
          cairo_set_font_size(tcr, size);
          cairo_set_source_rgba(tcr, r, g, b, 1.0); // bake color; alpha at composite
          cairo_move_to(tcr, pad - te.x_bearing, pad + fe.ascent);
          cairo_show_text(tcr, text.c_str());
          cairo_destroy(tcr);
          cairo_surface_flush(ts);
          TextEntry ne{ ts, te.width, te.x_bearing, fe.ascent, fe.descent, pad };
          e = textPut(key, ne);
        }
      }

      if (e) {
        // Cached: position by the same alignment/baseline math, then composite
        // the pre-rendered surface (no shaping, no glyph rasterization).
        double drawX = c[1];
        const double containerW = c[9];
        if (containerW > 0 && align != "left") {
          const double cX = c[8];
          if (align == "center")     drawX = cX + (containerW - e->width) / 2.0 - e->xBearing;
          else if (align == "right") drawX = cX + containerW - e->width - e->xBearing;
        }
        const double lineH = c[10];
        const double drawY = (lineH > 0)
          ? c[2] + (lineH - (e->ascent + e->descent)) / 2.0 + e->ascent
          : c[2] + e->ascent;
        cairo_save(cr);
        cairo_set_source_surface(cr, e->surf, drawX - e->pad + e->xBearing, drawY - e->pad - e->ascent);
        cairo_paint_with_alpha(cr, a);
        cairo_restore(cr);
      } else {
        // Uncacheable (oversized) → draw glyphs directly.
        cairo_select_font_face(cr, family.c_str(),
          italic ? CAIRO_FONT_SLANT_ITALIC : CAIRO_FONT_SLANT_NORMAL,
          bold   ? CAIRO_FONT_WEIGHT_BOLD  : CAIRO_FONT_WEIGHT_NORMAL);
        cairo_set_font_size(cr, size);
        cairo_set_source_rgba(cr, r, g, b, a);
        cairo_text_extents_t te; cairo_text_extents(cr, text.c_str(), &te);
        cairo_font_extents_t fe; cairo_font_extents(cr, &fe);
        double drawX = c[1];
        const double containerW = c[9];
        if (containerW > 0 && align != "left") {
          const double cX = c[8];
          if (align == "center")     drawX = cX + (containerW - te.width) / 2.0 - te.x_bearing;
          else if (align == "right") drawX = cX + containerW - te.width - te.x_bearing;
        }
        const double lineH = c[10];
        const double drawY = (lineH > 0)
          ? c[2] + (lineH - (fe.ascent + fe.descent)) / 2.0 + fe.ascent
          : c[2] + fe.ascent;
        cairo_move_to(cr, drawX, drawY);
        cairo_show_text(cr, text.c_str());
      }

    } else if (type == CT_DRAW_SVG) {
      double x = c[1], y = c[2], w = c[3], h = c[4];
      std::string src = getStr((int)c[17]);
      if (src.empty()) continue;
      int iw = (int)lround(w), ih = (int)lround(h);
      if (iw <= 0 || ih <= 0) continue;
      const bool cacheable = (long)iw * ih <= 512 * 256;
      const std::string key = cacheable
        ? src + '|' + std::to_string(iw) + 'x' + std::to_string(ih) : std::string();
      cairo_surface_t* bmp = cacheable ? svgGet(key) : nullptr;
      if (!bmp) {
        GError* gerr = nullptr;
        RsvgHandle* handle = (src[0] == '<')
          ? rsvg_handle_new_from_data(reinterpret_cast<const guint8*>(src.data()),
                                       static_cast<gsize>(src.size()), &gerr)
          : rsvg_handle_new_from_file(src.c_str(), &gerr);
        if (!handle) { if (gerr) g_error_free(gerr); continue; }
        if (cacheable) {
          bmp = cairo_image_surface_create(CAIRO_FORMAT_ARGB32, iw, ih);
          cairo_t* bcr = cairo_create(bmp);
          RsvgRectangle vp = { 0, 0, (double)iw, (double)ih };
          GError* rerr = nullptr;
          rsvg_handle_render_document(handle, bcr, &vp, &rerr);
          if (rerr) g_error_free(rerr);
          cairo_destroy(bcr);
          g_object_unref(handle);
          svgPut(key, bmp);
        } else {
          cairo_save(cr);
          RsvgRectangle vp = { x, y, w, h };
          GError* rerr = nullptr;
          rsvg_handle_render_document(handle, cr, &vp, &rerr);
          if (rerr) g_error_free(rerr);
          cairo_restore(cr);
          g_object_unref(handle);
          continue;
        }
      }
      cairo_save(cr);
      cairo_set_source_surface(cr, bmp, x, y);
      cairo_paint(cr);
      cairo_restore(cr);

    } else if (type == CT_DRAW_IMAGE) {
      double x = c[1], y = c[2], w = c[3], h = c[4];
      int sw = (int)c[5], sh = (int)c[6];
      double tl = c[7], tr = c[8], br = c[9], bl = c[10];
      if (sw <= 0 || sh <= 0 || w <= 0 || h <= 0) continue;
      int bidx = (int)c[20];
      if (bidx < 0 || (uint32_t)bidx >= buffers.Length()) continue;
      auto dataVal = buffers.Get((uint32_t)bidx);
      if (!dataVal.IsBuffer()) continue;
      Napi::Buffer<uint8_t> imgdata = dataVal.As<Napi::Buffer<uint8_t>>();
      int stride = cairo_format_stride_for_width(CAIRO_FORMAT_ARGB32, sw);
      if (imgdata.Length() < (size_t)(stride * sh)) continue;
      cairo_surface_t* img = cairo_image_surface_create_for_data(
        imgdata.Data(), CAIRO_FORMAT_ARGB32, sw, sh, stride);
      if (cairo_surface_status(img) != CAIRO_STATUS_SUCCESS) {
        cairo_surface_destroy(img); continue;
      }
      cairo_save(cr);
      rounded_rect(cr, x, y, w, h, tl, tr, br, bl);
      cairo_clip(cr);
      cairo_translate(cr, x, y);
      cairo_scale(cr, w / (double)sw, h / (double)sh);
      cairo_set_source_surface(cr, img, 0, 0);
      cairo_pattern_set_filter(cairo_get_source(cr), CAIRO_FILTER_GOOD);
      cairo_paint(cr);
      cairo_restore(cr);
      cairo_surface_destroy(img);
    }
  }

  cairo_surface_flush(surf_);

  if (kBlitProf) {
    pTotal += msSince(_renderT0);
    if (++pFrames >= 30) {
      fprintf(stderr,
        "[native] render avg/frame: total=%.2fms | shapes=%.2f text=%.2f svg=%.2f image=%.2f other=%.2f (ms)\n",
        pTotal / pFrames, pShape / pFrames, pText / pFrames, pSvg / pFrames, pImage / pFrames, pOther / pFrames);
      pTotal = pShape = pText = pSvg = pImage = pOther = 0;
      pFrames = 0;
    }
  }
}

void CairoRenderer::screenshot(const std::string& path) {
  cairo_surface_t* fb_surf = cairo_image_surface_create_for_data(
    buf_, CAIRO_FORMAT_ARGB32, (int)fb_w_, (int)fb_h_, (int)stride_);
  if (cairo_surface_status(fb_surf) != CAIRO_STATUS_SUCCESS) {
    cairo_surface_destroy(fb_surf);
    throw std::runtime_error("screenshot: failed to wrap framebuffer");
  }

  // RGB24 drops the framebuffer's undefined X channel from the PNG.
  int lw = rotate90_ ? (int)fb_h_ : (int)fb_w_;
  int lh = rotate90_ ? (int)fb_w_ : (int)fb_h_;
  cairo_surface_t* out = cairo_image_surface_create(CAIRO_FORMAT_RGB24, lw, lh);
  cairo_t* cr = cairo_create(out);

  if (rotate90_) {
    // render() maps logical (lx,ly) → fb (fb_w−ly, lx); sampling the
    // framebuffer through the same matrix as a pattern transform undoes it.
    cairo_pattern_t* pat = cairo_pattern_create_for_surface(fb_surf);
    cairo_matrix_t m;
    m.xx = 0;  m.xy = -1; m.x0 = (double)fb_w_;
    m.yx = 1;  m.yy = 0;  m.y0 = 0;
    cairo_pattern_set_matrix(pat, &m);
    cairo_set_source(cr, pat);
    cairo_paint(cr);
    cairo_pattern_destroy(pat);
  } else {
    cairo_set_source_surface(cr, fb_surf, 0, 0);
    cairo_paint(cr);
  }

  cairo_status_t st = cairo_surface_write_to_png(out, path.c_str());
  cairo_destroy(cr);
  cairo_surface_destroy(out);
  cairo_surface_destroy(fb_surf);
  if (st != CAIRO_STATUS_SUCCESS)
    throw std::runtime_error(std::string("screenshot: ") + cairo_status_to_string(st));
}
