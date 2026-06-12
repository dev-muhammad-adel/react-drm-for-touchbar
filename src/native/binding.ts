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

interface NativeModule {
  DrmDisplay: new (devicePath: string) => NativeHandle;
  usbReset(devnode: string): void;
}

// Lazy-load the native addon — fails with a clear message if not built yet.
function loadNative(): NativeModule {
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

/**
 * USBDEVFS_RESET ioctl on a USB device node (`/dev/bus/usb/BBB/DDD`).
 * Wakes the Touch Bar firmware's display interface out of its idle sleep —
 * the state where every transfer (including config switches) fails with
 * ETIMEDOUT. Needs write access to the node (see system/99-react-drm.rules).
 */
export function usbReset(devnode: string): void {
  loadNative().usbReset(devnode);
}

export class DrmDisplay {
  private handle: NativeHandle;
  private readonly devicePath?: string;
  private closed = false;

  readonly width: number;
  readonly height: number;

  constructor(devicePath?: string) {
    this.devicePath = devicePath;
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
    if (this.closed) return;
    this.closed = true;
    try { this.handle.close(); } catch { /* fd may already be dead (device gone) */ }
  }

  /**
   * Reopen the display after the device was lost and came back (e.g. the
   * Touch Bar re-enumerates after suspend). Re-resolves the card path — the
   * card number can change across re-enumeration.
   */
  reopen(): void {
    this.close();
    const native = loadNative();
    const resolvedPath = resolveCardPath(this.devicePath);
    this.handle = new native.DrmDisplay(resolvedPath);
    const info = this.handle.setup();
    this.closed = false;
    if (info.width !== this.width || info.height !== this.height) {
      console.warn(`[react-drm] display size changed on reopen: ${info.width}×${info.height} (was ${this.width}×${this.height})`);
    }
    console.log(`[react-drm] DRM display reopened on ${resolvedPath}`);
  }
}
