#pragma once
#include <cstdint>
#include <string>
#include <xf86drmMode.h>

class DrmDevice {
public:
  explicit DrmDevice(const std::string& path);
  ~DrmDevice();

  // Non-copyable
  DrmDevice(const DrmDevice&) = delete;
  DrmDevice& operator=(const DrmDevice&) = delete;

  // Open + detect mode + allocate framebuffer
  void setup();

  uint8_t*  buffer()       const { return map_; }
  uint32_t  fb_width()     const { return fb_width_; }
  uint32_t  fb_height()    const { return fb_height_; }
  uint32_t  stride()       const { return stride_; }
  // Logical dimensions exposed to JS (swapped when the panel is rotated 90°).
  uint32_t  width()        const { return rotate90_ ? fb_height_ : fb_width_; }
  uint32_t  height()       const { return rotate90_ ? fb_width_  : fb_height_; }
  bool      rotate90()     const { return rotate90_; }


  void dirty(const drmModeClip* clips = nullptr, uint32_t count = 0);

private:
  int       fd_        = -1;
  uint32_t  conn_id_   = 0;
  uint32_t  crtc_id_   = 0;
  uint32_t  fb_id_     = 0;
  uint32_t  handle_    = 0;
  uint32_t  fb_width_  = 0;
  uint32_t  fb_height_ = 0;
  uint32_t  stride_    = 0;
  uint64_t  map_size_  = 0;
  uint8_t*  map_       = nullptr;
  bool      rotate90_  = false;
  drmModeModeInfo mode_{};
};
