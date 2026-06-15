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
                        double sr, double sg, double sb, double sa) {
  if (sa <= 0 || w <= 0 || h <= 0) return;
  int pad = (int)std::ceil(blur);
  int sw  = (int)std::ceil(w) + 2 * pad;
  int sh  = (int)std::ceil(h) + 2 * pad;

  cairo_surface_t* surf = cairo_image_surface_create(CAIRO_FORMAT_A8, sw, sh);
  cairo_t* scr = cairo_create(surf);
  rounded_rect(scr, pad, pad, w, h, tl, tr, br, bl);
  cairo_set_source_rgba(scr, 0, 0, 0, 1);
  cairo_fill(scr);
  cairo_destroy(scr);
  cairo_surface_flush(surf);

  uint8_t* data   = cairo_image_surface_get_data(surf);
  int      stride = cairo_image_surface_get_stride(surf);
  blur_a8(data, sw, sh, stride, pad);
  cairo_surface_mark_dirty(surf);

  cairo_save(cr);
  cairo_set_source_rgba(cr, sr, sg, sb, sa);
  cairo_mask_surface(cr, surf, x + dx - pad, y + dy - pad);
  cairo_restore(cr);

  cairo_surface_destroy(surf);
}

CairoRenderer::CairoRenderer(uint8_t* buf, uint32_t fb_w, uint32_t fb_h, uint32_t stride, bool rotate90)
  : buf_(buf), fb_w_(fb_w), fb_h_(fb_h), stride_(stride), rotate90_(rotate90) {}

CairoRenderer::~CairoRenderer() {
  for (auto& entry : svg_lru_) cairo_surface_destroy(entry.second);
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
  cairo_surface_t* surf = cairo_image_surface_create_for_data(
    buf_, CAIRO_FORMAT_ARGB32, (int)fb_w_, (int)fb_h_, (int)stride_);
  if (cairo_surface_status(surf) != CAIRO_STATUS_SUCCESS) { cairo_surface_destroy(surf); return; }
  cairo_t* cr = cairo_create(surf);
  if (rotate90_) {
    cairo_matrix_t m;
    m.xx = 0; m.xy = -1; m.x0 = (double)fb_w_;
    m.yx = 1; m.yy = 0;  m.y0 = 0;
    cairo_set_matrix(cr, &m);
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

  cairo_destroy(cr);
  cairo_surface_flush(surf);
  cairo_surface_destroy(surf);
}

void CairoRenderer::render(Napi::Env env, Napi::Array commands) {
  // Cairo ARGB32 maps directly to DRM XRGB8888 on little-endian:
  // both store pixels as [B, G, R, _] in memory.
  cairo_surface_t* surf = cairo_image_surface_create_for_data(
    buf_, CAIRO_FORMAT_ARGB32, (int)fb_w_, (int)fb_h_, (int)stride_);
  if (cairo_surface_status(surf) != CAIRO_STATUS_SUCCESS) {
    cairo_surface_destroy(surf);
    throw std::runtime_error("cairo_image_surface_create_for_data failed");
  }

  cairo_t* cr = cairo_create(surf);
  if (cairo_status(cr) != CAIRO_STATUS_SUCCESS) {
    cairo_destroy(cr);
    cairo_surface_destroy(surf);
    throw std::runtime_error("cairo_create failed");
  }

  if (rotate90_) {
    // appletbdrm applies 90° CCW to the framebuffer before scanout.
    // To display content upright, map logical (lx,ly) → fb (fb_w-ly, lx).
    // m.x0 = fb_w_ (not fb_w_-1) so logical y=0 aligns to the right edge of
    // the last pixel column, giving correct sub-pixel coverage for strokes at
    // both the top (y=0.5 → fb_x=fb_w-0.5) and bottom (y=h-0.5 → fb_x=0.5).
    cairo_matrix_t m;
    m.xx = 0;  m.xy = -1; m.x0 = (double)fb_w_;
    m.yx = 1;  m.yy = 0;  m.y0 = 0;
    cairo_set_matrix(cr, &m);
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
      cairo_set_source_rgb(cr, numProp(cmd, "r"), numProp(cmd, "g"), numProp(cmd, "b"));
      cairo_paint(cr);

    } else if (type == "shadow") {
      double x = numProp(cmd, "x"), y = numProp(cmd, "y");
      double w = numProp(cmd, "w"), h = numProp(cmd, "h");
      double tl = numProp(cmd, "tl"), tr = numProp(cmd, "tr");
      double br = numProp(cmd, "br"), bl = numProp(cmd, "bl");
      double a  = numProp(cmd, "a");
      draw_shadow(cr, x, y, w, h, tl, tr, br, bl,
                  numProp(cmd, "dx"), numProp(cmd, "dy"), numProp(cmd, "blur"),
                  numProp(cmd, "r"),  numProp(cmd, "g"),  numProp(cmd, "b"), a);

    } else if (type == "fill_rect") {
      double x = numProp(cmd, "x"), y = numProp(cmd, "y");
      double w = numProp(cmd, "w"), h = numProp(cmd, "h");
      double a = numProp(cmd, "a"); if (a <= 0) a = 1.0;
      double tl = numProp(cmd, "tl"), tr = numProp(cmd, "tr");
      double br = numProp(cmd, "br"), bl = numProp(cmd, "bl");
      cairo_set_source_rgba(cr, numProp(cmd, "r"), numProp(cmd, "g"), numProp(cmd, "b"), a);
      rounded_rect(cr, x, y, w, h, tl, tr, br, bl);
      cairo_fill(cr);

    } else if (type == "stroke_rect") {
      double x = numProp(cmd, "x"), y = numProp(cmd, "y");
      double w = numProp(cmd, "w"), h = numProp(cmd, "h");
      double a = numProp(cmd, "a"); if (a <= 0) a = 1.0;
      double lw = numProp(cmd, "lineWidth");
      double tl = numProp(cmd, "tl"), tr = numProp(cmd, "tr");
      double br = numProp(cmd, "br"), bl = numProp(cmd, "bl");
      std::string bstyle = strProp(cmd, "borderStyle");
      // Inset by lw/2 so the stroke stays fully inside the rect bounds.
      double ins = lw / 2.0;
      cairo_set_source_rgba(cr, numProp(cmd, "r"), numProp(cmd, "g"), numProp(cmd, "b"), a);
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
      std::string family = strProp(cmd, "family");
      std::string text   = strProp(cmd, "text");
      bool bold   = cmd.Get("bold").ToBoolean().Value();
      bool italic = cmd.Get("italic").ToBoolean().Value();

      std::string align  = strProp(cmd, "align");
      double containerX  = numProp(cmd, "containerX");
      double containerW  = numProp(cmd, "containerW");

      cairo_set_source_rgba(cr, numProp(cmd, "r"), numProp(cmd, "g"), numProp(cmd, "b"), a);
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
      double lineH = numProp(cmd, "lineHeight");
      // With lineHeight: center text vertically within the line box.
      // Without: y is the top of the text bounding box (ascent offset only).
      double drawY = (lineH > 0)
        ? y + (lineH - (fe.ascent + fe.descent)) / 2.0 + fe.ascent
        : y + fe.ascent;
      cairo_move_to(cr, drawX, drawY);
      cairo_show_text(cr, text.c_str());
    } else if (type == "overlay") {
      // Semi-transparent black veil — used for screen-saver dim step.
      double a = numProp(cmd, "a");
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

      double tl = numProp(cmd, "tl"), tr = numProp(cmd, "tr");
      double br = numProp(cmd, "br"), bl = numProp(cmd, "bl");

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

  cairo_destroy(cr);
  cairo_surface_flush(surf);
  cairo_surface_destroy(surf);

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
