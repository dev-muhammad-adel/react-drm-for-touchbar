#pragma once
#include <napi.h>

// Returns /dev/input/eventN of the first seat0 keyboard via libudev.
Napi::Value FindKeyboardDevice(const Napi::CallbackInfo& info);

// Returns array of /dev/input/eventN paths for all seat0 keyboards.
Napi::Value FindKeyboardDevices(const Napi::CallbackInfo& info);

// Returns array of /dev/input/eventN paths for all pointer devices
// (touchpad, touchscreen, mouse) across all seats — used for idle detection.
Napi::Value FindPointerDevices(const Napi::CallbackInfo& info);

// Returns /dev/input/eventN of the lid switch device, or throws if not found.
Napi::Value FindLidDevice(const Napi::CallbackInfo& info);
