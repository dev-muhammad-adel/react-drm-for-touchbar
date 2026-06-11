import fs from 'fs';
import path from 'path';
import type { DrawCommand } from '../scene/serialize';

function resolveCardPath(devicePath?: string): string {
  if (devicePath) return devicePath;

  const envPath = process.env.REACT_DRM_DEVICE_PATH;
  if (envPath) return envPath;

  // Prefer appletbdrm (Touch Bar) if present
  try {
    const cards = fs.readdirSync('/sys/class/drm').filter(n => /^card\d+$/.test(n));
    for (const card of cards) {
      const uevent = fs.readFileSync(`/sys/class/drm/${card}/device/uevent`, 'utf8');
      if (/DRIVER=appletbdrm/i.test(uevent)) return `/dev/dri/${card}`;
    }
  } catch (_) { /* fall through */ }

  return '/dev/dri/card1';
}

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
  screenshot(filePath: string): void;
  getWidth(): number;
  getHeight(): number;
  close(): void;
}

export class DrmDisplay {
  private handle: NativeHandle;
  readonly width: number;
  readonly height: number;

  constructor(devicePath?: string) {
    const native = loadNative();
    const resolvedPath = resolveCardPath(devicePath);
    this.handle = new native.DrmDisplay(resolvedPath);
    const info = this.handle.setup();
    this.width = info.width;
    this.height = info.height;
    console.log(`[react-drm] DRM display ready: ${this.width}×${this.height} on ${resolvedPath}`);
  }

  render(commands: DrawCommand[]): void {
    this.handle.render(commands);
  }

  /** Write the currently displayed frame to a PNG file (logical orientation). */
  screenshot(filePath: string): void {
    this.handle.screenshot(filePath);
  }

  close(): void {
    this.handle.close();
  }
}
