#include "cairo_renderer.h"
#include <cairo/cairo.h>
#include <librsvg/rsvg.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <string>
#include <vector>

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
    // To display content upright, map logical (lx,ly) → fb (fb_w-1-ly, lx).
    cairo_matrix_t m;
    m.xx = 0;  m.xy = -1; m.x0 = (double)(fb_w_ - 1);
    m.yx = 1;  m.yy = 0;  m.y0 = 0;
    cairo_set_matrix(cr, &m);
  }

  uint32_t len = commands.Length();
  for (uint32_t i = 0; i < len; ++i) {
    if (!commands.Get(i).IsObject()) continue;
    Napi::Object cmd = commands.Get(i).As<Napi::Object>();
    std::string type = strProp(cmd, "cmd");

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
      // Inset by lw/2 so the stroke stays fully inside the rect bounds.
      double ins = lw / 2.0;
      cairo_set_source_rgba(cr, numProp(cmd, "r"), numProp(cmd, "g"), numProp(cmd, "b"), a);
      cairo_set_line_width(cr, lw);
      rounded_rect(cr, x + ins, y + ins, w - 2*ins, h - 2*ins,
                   fmax(0.0, tl - ins), fmax(0.0, tr - ins),
                   fmax(0.0, br - ins), fmax(0.0, bl - ins));
      cairo_stroke(cr);

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

      cairo_set_source_rgba(cr, numProp(cmd, "r"), numProp(cmd, "g"), numProp(cmd, "b"), a);
      cairo_select_font_face(cr, family.c_str(),
                             CAIRO_FONT_SLANT_NORMAL,
                             CAIRO_FONT_WEIGHT_NORMAL);
      cairo_set_font_size(cr, size);

      // Measure ascent so that `y` is the top of the text bounding box.
      cairo_font_extents_t fe;
      cairo_font_extents(cr, &fe);
      cairo_move_to(cr, x, y + fe.ascent);
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

      GError *gerr = nullptr;
      RsvgHandle *handle = nullptr;

      if (src[0] == '<') {
        // Inline SVG markup
        handle = rsvg_handle_new_from_data(
          reinterpret_cast<const guint8*>(src.data()),
          static_cast<gsize>(src.size()), &gerr);
      } else {
        // File path
        handle = rsvg_handle_new_from_file(src.c_str(), &gerr);
      }

      if (!handle) {
        if (gerr) g_error_free(gerr);
        continue;
      }

      cairo_save(cr);
      RsvgRectangle viewport = { x, y, w, h };
      rsvg_handle_render_document(handle, cr, &viewport, &gerr);
      if (gerr) g_error_free(gerr);
      cairo_restore(cr);
      g_object_unref(handle);

    }
    // Unknown commands are silently skipped.
  }

  cairo_destroy(cr);
  cairo_surface_flush(surf);
  cairo_surface_destroy(surf);
}
