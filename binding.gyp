{
  "targets": [
    {
      "target_name": "drm_backend",
      "cflags_cc!": ["-fno-exceptions"],
      "cflags_cc": ["-std=c++17", "-fexceptions", "-Wall", "-Wextra", "-Wno-unused-parameter"],
      "sources": [
        "native/src/binding.cpp",
        "native/src/drm.cpp",
        "native/src/cairo_renderer.cpp",
        "native/src/touch_input.cpp",
        "native/src/key_injector.cpp",
        "native/src/keyboard_reader.cpp",
        "native/src/udev_keyboard.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "/usr/include/libdrm",
        "/usr/include/cairo",
        "/usr/include/freetype2",
        "/usr/include/pixman-1",
        "<!@(pkg-config --cflags-only-I librsvg-2.0 | tr ' ' '\\n' | sed 's/-I//')",
        "<!@(pkg-config --cflags-only-I pangocairo | tr ' ' '\\n' | sed 's/-I//')"
      ],
      "libraries": [
        "-ldrm",
        "-lcairo",
        "-ludev",
        "<!@(pkg-config --libs librsvg-2.0)",
        "<!@(pkg-config --libs pangocairo)"
      ],
      "defines": ["NAPI_CPP_EXCEPTIONS"]
    }
  ]
}
