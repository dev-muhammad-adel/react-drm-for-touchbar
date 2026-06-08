import type React from 'react';

export type LayerAnimation = 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down';

export interface FromLayerSwitch {
  outAnim?:  LayerAnimation;
  duration?: number;
}

export interface ToLayerSwitch {
  inAnim?:    LayerAnimation;
  duration?:  number;
  /** ms from the switch trigger before this layer starts appearing. */
  showAfter?: number;
}

export interface SwitchOptions {
  fromLayerSwitch?: FromLayerSwitch;
  toLayerSwitch?:   ToLayerSwitch;
}

export interface Layer {
  name:      string;
  component: React.ComponentType<{ width: number; height: number }>;
  /** Structured config for when this layer leaves the screen. */
  leaving?:   FromLayerSwitch;
  /** Structured config for when this layer enters the screen. */
  entering?:  ToLayerSwitch;
  /** Shorthand: applies to both inAnim and outAnim when the specific one is not set. */
  animation?: LayerAnimation;
  /** Flat shorthand for entering.inAnim. */
  inAnim?:    LayerAnimation;
  /** Flat shorthand for leaving.outAnim. */
  outAnim?:   LayerAnimation;
  /** Flat shorthand for entering.showAfter. */
  enterDelay?: number;
  /** Flat shorthand for both entering.duration and leaving.duration. */
  duration?:  number;
}
