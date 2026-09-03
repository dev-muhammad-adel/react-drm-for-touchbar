import { initCustomLayerStore } from './store';
import { startCustomLayerBridge } from './bridge';

export type { CustomLayerState } from './store';
export { getCustomLayerStore } from './store';

export interface CustomLayerHandle {
  stop(): void;
}

/** Width reserved for the BackButton at the left edge of the custom-layer page. */
export const BACK_BUTTON_WIDTH = 60;

/**
 * Single entry point for the whole Custom Layer prototype's runtime side —
 * everything it needs (the in-memory store + its Unix-socket bridge to
 * config-gui) is owned and started from here, so index.tsx only has to make
 * one call rather than reaching into this module's internals itself.
 */
export function startCustomLayer(barWidth: number, barHeight: number): CustomLayerHandle {
  initCustomLayerStore(barWidth, barHeight, BACK_BUTTON_WIDTH);
  const bridge = startCustomLayerBridge();
  return { stop: () => bridge.stop() };
}
