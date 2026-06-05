import path from 'path';
import type { DrawCommand } from '../scene/serialize';

// Lazy-load the native addon — fails with a clear message if not built yet.
function loadNative(): { DrmDisplay: new (devicePath: string) => NativeHandle } {
  const candidates = [
    path.join(__dirname, '../../build/Release/drm_backend.node'),
    path.join(__dirname, '../../build/Debug/drm_backend.node'),
  ];
  for (const p of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require(p);
    } catch (_) { /* try next */ }
  }
  throw new Error(
    'react-drm: native addon not found.\n' +
    'Run `npm run build:native` first.\n' +
    'You may need libdrm-dev and libcairo2-dev installed.'
  );
}

interface NativeHandle {
  setup(): { width: number; height: number };
  render(commands: DrawCommand[]): void;
  getWidth(): number;
  getHeight(): number;
  close(): void;
}

export class DrmDisplay {
  private handle: NativeHandle;
  readonly width: number;
  readonly height: number;

  constructor(devicePath = '/dev/dri/card1') {
    const native = loadNative();
    this.handle = new native.DrmDisplay(devicePath);
    const info = this.handle.setup();
    this.width = info.width;
    this.height = info.height;
    console.log(`[react-drm] DRM display ready: ${this.width}×${this.height} on ${devicePath}`);
  }

  render(commands: DrawCommand[]): void {
    this.handle.render(commands);
  }

  close(): void {
    this.handle.close();
  }
}
