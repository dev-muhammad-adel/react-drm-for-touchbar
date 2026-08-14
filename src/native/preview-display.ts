import { loadAddon } from './load-addon';
import { DEFAULT_DISPLAY_W, DEFAULT_DISPLAY_H } from './input';
import type { Display, DamageRect, BarsOpts } from './binding';
import type { DrawCommand, BinaryFrame } from '../scene/serialize';
import { createLogger } from '../logger';

const log = createLogger('display');

interface NativePreviewHandle {
  setup(): { width: number; height: number };
  render(commands: DrawCommand[]): void;
  renderBinary(data: Float32Array, strings: string[], buffers: Buffer[]): void;
  drawBars(opts: BarsOpts): void;
  screenshot(filePath: string): void;
  getWidth(): number;
  getHeight(): number;
  /** Latest framebuffer contents, already converted to RGBA8888 for canvas ImageData. */
  getFrameBuffer(): Buffer;
  close(): void;
}

interface NativeModule {
  PreviewDisplay: new (width?: number, height?: number) => NativePreviewHandle;
}

function loadNative(): NativeModule {
  return loadAddon() as unknown as NativeModule;
}

/**
 * In-memory Cairo framebuffer for the browser dev preview — same native
 * CairoRenderer as DrmDisplay, minus the DRM device. Requires no /dev/dri,
 * no root, no Touch Bar hardware.
 *
 * Set `onFrame` to receive the RGBA bytes after every completed render —
 * src/dev/preview-server.ts uses this to broadcast frames over WebSocket.
 */
export class PreviewDisplay implements Display {
  private handle: NativePreviewHandle;
  private closed = false;

  readonly width: number;
  readonly height: number;

  /** Called with the freshly-rendered frame after render/renderBinary/drawBars. */
  onFrame?: (rgba: Buffer, width: number, height: number) => void;

  constructor(width: number = DEFAULT_DISPLAY_W, height: number = DEFAULT_DISPLAY_H) {
    const native = loadNative();
    this.handle = new native.PreviewDisplay(width, height);
    const info = this.handle.setup();
    this.width = info.width;
    this.height = info.height;
    log.info(`preview display ready: ${this.width}×${this.height} (no hardware)`);
  }

  private emitFrame(): void {
    if (!this.onFrame) return;
    this.onFrame(this.handle.getFrameBuffer(), this.width, this.height);
  }

  // clips are accepted for interface compatibility with DrmDisplay but unused —
  // there's no partial-scanout hardware quirk to work around in preview mode,
  // and the browser always redraws the whole canvas from the latest frame.
  render(commands: DrawCommand[], _clips?: DamageRect[]): void {
    this.handle.render(commands);
    this.emitFrame();
  }

  renderBinary(frame: BinaryFrame, _clips?: DamageRect[]): void {
    this.handle.renderBinary(frame.data, frame.strings, frame.buffers);
    this.emitFrame();
  }

  drawBars(opts: BarsOpts): void {
    this.handle.drawBars(opts);
    this.emitFrame();
  }

  screenshot(filePath: string): void {
    this.handle.screenshot(filePath);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.handle.close(); } catch { /* already closed */ }
  }

  /** No-op: there's no device to lose/reopen in preview mode. */
  reopen(): void {}
}
