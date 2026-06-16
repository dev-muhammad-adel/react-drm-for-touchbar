import React, { useEffect, useRef } from 'react';
import fs from 'fs';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { invalidate } from '../renderer/invalidate';
import type { GifNode } from '../scene/types';
import type { Style } from '../scene/style';

export interface GifProps {
  /** Absolute path to a `.gif` file. */
  src: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  /** Repeat after the last frame. Default: true. */
  loop?: boolean;
  /** Advance frames. When false the current frame holds. Default: true. */
  playing?: boolean;
  style?: Style;
}

interface DecodedFrame {
  /** Full-canvas premultiplied BGRA — ready for the native draw_image command. */
  data: Buffer;
  /** Hold time in milliseconds before the next frame. */
  delay: number;
}

interface Decoded {
  w: number;
  h: number;
  frames: DecodedFrame[];
}

// Convert a straight RGBA canvas to the premultiplied BGRA that Cairo's ARGB32
// expects on little-endian (memory order B,G,R,A). GIF alpha is effectively
// 1-bit (0 or 255), so the common paths are exact copies; the general branch
// covers the rare partially-transparent pixel correctly.
function toPremultBGRA(rgba: Uint8Array, w: number, h: number): Buffer {
  const out = Buffer.allocUnsafe(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * 4;
    const a = rgba[s + 3];
    if (a === 0) {
      out.writeUInt32LE(0, s);
    } else if (a === 255) {
      out[s]     = rgba[s + 2]; // B
      out[s + 1] = rgba[s + 1]; // G
      out[s + 2] = rgba[s];     // R
      out[s + 3] = 255;
    } else {
      out[s]     = Math.round(rgba[s + 2] * a / 255);
      out[s + 1] = Math.round(rgba[s + 1] * a / 255);
      out[s + 2] = Math.round(rgba[s]     * a / 255);
      out[s + 3] = a;
    }
  }
  return out;
}

// Decode a GIF to full-canvas frames. GIF frames are patches over a persistent
// canvas with a per-frame disposal method, so we composite each patch and
// snapshot the whole canvas — playback is then a plain buffer swap.
function decodeGif(buf: Buffer): Decoded {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const gif = parseGIF(ab);
  const w = gif.lsd.width;
  const h = gif.lsd.height;
  const raw = decompressFrames(gif, true);

  const canvas = new Uint8Array(w * h * 4); // transparent
  let prev: Uint8Array | null = null;
  const frames: DecodedFrame[] = [];

  for (const f of raw) {
    if (f.disposalType === 3) prev = canvas.slice(); // restore-to-previous: save first

    const { width: pw, height: ph, top, left } = f.dims;
    const patch = f.patch;
    for (let row = 0; row < ph; row++) {
      const srcOff  = row * pw * 4;
      const dstBase = ((top + row) * w + left) * 4;
      for (let col = 0; col < pw; col++) {
        const sp = srcOff + col * 4;
        const a  = patch[sp + 3];
        if (a === 0) continue; // transparent: keep the pixel underneath
        const dp = dstBase + col * 4;
        canvas[dp]     = patch[sp];
        canvas[dp + 1] = patch[sp + 1];
        canvas[dp + 2] = patch[sp + 2];
        canvas[dp + 3] = a;
      }
    }

    frames.push({ data: toPremultBGRA(canvas, w, h), delay: f.delay > 0 ? f.delay : 100 });

    if (f.disposalType === 2) {
      // restore-to-background: clear just the patch region back to transparent
      for (let row = 0; row < ph; row++) {
        const o = ((top + row) * w + left) * 4;
        canvas.fill(0, o, o + pw * 4);
      }
    } else if (f.disposalType === 3 && prev) {
      canvas.set(prev);
    }
  }

  return { w, h, frames };
}

/**
 * Plays an animated GIF on the bar. Decoded once on mount; playback swaps the
 * current frame straight into the scene node and requests a repaint (the same
 * out-of-band path the spring adapter uses), so it never goes through React.
 *
 * A playing GIF deliberately does NOT count as user activity — the screen
 * saver can still dim/blank over it. While the screen is off, repaints are
 * dropped by the renderer, so the only cost is the (cheap) buffer swap.
 */
export function Gif(props: GifProps): React.ReactElement {
  const { src, width, height, x, y, loop = true, playing = true, style } = props;

  const nodeRef = useRef<GifNode | null>(null);

  // Load, decode, and play in one effect so playback ALWAYS begins at frame 0:
  // the frame index lives in this run's closure, not a ref that survives
  // remounts/hot-reloads, and the loop is kicked off the moment decoding
  // finishes rather than racing a separate polling timer.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const draw = (dec: Decoded, i: number): void => {
      const node = nodeRef.current;
      if (!node) return;
      const fr = dec.frames[i];
      node.frame  = fr.data;
      node.frameW = dec.w;
      node.frameH = dec.h;
      invalidate(false);
    };

    // Self-scheduling by each frame's own delay (GIFs aren't a fixed rate).
    const play = (dec: Decoded, i: number): void => {
      if (cancelled) return;
      draw(dec, i);
      const next = i + 1;
      if (next >= dec.frames.length && !loop) return; // hold on the last frame
      timer = setTimeout(() => play(dec, next % dec.frames.length), dec.frames[i].delay);
    };

    fs.promises.readFile(src)
      .then(buf => {
        if (cancelled) return;
        const dec = decodeGif(buf);
        if (dec.frames.length === 0) return;
        if (playing) play(dec, 0);
        else draw(dec, 0); // paused: show the first frame
      })
      .catch(e => console.warn('[react-drm] <Gif> failed to load', src, (e as Error).message));

    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [src, playing, loop]);

  return React.createElement('gif_image', { ref: nodeRef, x, y, width, height, style });
}
