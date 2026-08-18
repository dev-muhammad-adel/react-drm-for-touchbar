import { atom } from 'jotai';

/**
 * Track width for the anchored (long-press-and-drag) popover — deliberately
 * smaller than the default centered slider's TRACK_W, since this one floats
 * near wherever the finger pressed rather than spanning the layer. Shared by
 * splittedLayer.tsx's drag math and audioSlider.tsx's rendering + its own
 * direct-touch drag, so the knob position stays consistent regardless of
 * which one is currently driving the touch.
 */
export const ANCHOR_TRACK_W = 300;

export interface AudioTrackAnchor {
  /** Screen x for the track's own left edge, positioned so the track's
   *  center lands on the touch point — trackLeft = touchX - ANCHOR_TRACK_W/2.
   *  Fixed regardless of volume; the knob then sits wherever the current
   *  fill places it within that centered track. */
  x: number;
}

/**
 * Where the audio-slider track should render, so it's centered on the
 * button/touch that opened it — null means "use the default centered
 * layout." Set once per open (tap resets it to null, long-press anchors it
 * to the touch x) — not updated live during a drag: the anchor is fixed,
 * only the knob moves within the now-stationary track as fill/volume
 * changes (same delta-based volume calc as always).
 */
export const audioTrackAnchorAtom = atom<AudioTrackAnchor | null>(null);
