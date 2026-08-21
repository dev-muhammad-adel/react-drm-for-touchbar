export interface SpringPreset {
  tension: number;
  friction: number;
  mass?: number;
}

/** Named spring configs so components share one motion vocabulary instead of
 *  each hand-writing its own {tension, friction} numbers. */
export const SPRING = {
  /** Quick, controlled — press feedback, toggles. */
  snappy: { tension: 400, friction: 28 } as SpringPreset,
  /** Soft settle — entrances, fades. */
  gentle: { tension: 180, friction: 24 } as SpringPreset,
  /** Playful overshoot before settling. */
  bouncy: { tension: 300, friction: 12 } as SpringPreset,
  /** Near-instant, minimal settle. */
  stiff:  { tension: 500, friction: 40 } as SpringPreset,
} satisfies Record<string, SpringPreset>;
