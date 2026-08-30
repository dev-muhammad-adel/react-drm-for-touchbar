export type CustomWidgetType = 'cpu' | 'battery' | 'media' | 'volume' | 'clock' | 'weather' | 'capslock' | 'mic' | 'ram' | 'cava' | 'activewindow' | 'separator' | 'clipboard';

export interface CustomWidget {
  id: string;
  type: CustomWidgetType;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CustomLayerConfig {
  widgets: CustomWidget[];
}

export const CUSTOM_LAYER_DEFAULT_WIDTH = 120;
export const CUSTOM_LAYER_DEFAULT_HEIGHT = 50;

// Resize bounds — min keeps a widget from shrinking past its own icon, max
// is a generous cap well short of anything close to the bar's own width.
export const CUSTOM_WIDGET_MIN_WIDTH = 30;
export const CUSTOM_WIDGET_MAX_WIDTH = 500;
export const CUSTOM_WIDGET_RESIZE_STEP = 10;

export const CUSTOM_WIDGET_LABELS: Record<CustomWidgetType, string> = {
  cpu: 'CPU',
  battery: 'Battery',
  media: 'Media',
  volume: 'Volume',
  clock: 'Clock',
  weather: 'Weather',
  capslock: 'Caps Lock',
  mic: 'Mic Mute',
  ram: 'RAM',
  cava: 'Visualizer',
  activewindow: 'Active Window',
  separator: 'Separator',
  clipboard: 'Clipboard',
};

// A single uniform width forced every widget into the same box regardless of
// content — fine for a plain label, wasteful for an icon-only widget (Mic
// Mute) and potentially tight for a longer one (Clock). Sized per type
// instead, roughly matching each widget's actual rendered content.
export const CUSTOM_WIDGET_WIDTHS: Record<CustomWidgetType, number> = {
  cpu: 60,
  battery: 64,
  media: 100,
  volume: 70,
  clock: 72,
  weather: 64,
  capslock: 60,
  mic: 40,
  ram: 60,
  cava: 46,
  // Window titles run long — start wide; the on-device resize handle and
  // config-gui's +/- buttons take it from there.
  activewindow: 170,
  // A hairline divider.
  separator: 10,
  // Clipboard — wide enough for a short preview.
  clipboard: 100,
};

// Protocol for the local bridge between config-gui (client) and the Touch
// Bar process (server, see linux-touchbar-control-center/lib/customLayer/).
// config-gui has no on-screen representation of the bar itself — dragMove's
// x/y are already in the bar's own CUSTOM_LAYER_GRID_SIZE-space coordinates
// by the time they're sent (config-gui maps its own window-relative pointer
// position into that space before sending).
export type CustomLayerClientMessage =
  | { type: 'requestState' }
  | { type: 'dragStart'; widgetType: CustomWidgetType }
  | { type: 'dragMove'; x: number; y: number }
  | { type: 'dragEnd'; commit: boolean }
  | { type: 'remove'; id: string }
  | { type: 'resize'; id: string; width: number }
  | { type: 'save' }
  | { type: 'reset' };

export interface CustomLayerDragGhost {
  widgetType: CustomWidgetType;
  x: number;
  y: number;
}

export type CustomLayerServerMessage =
  | {
      type: 'state';
      widgets: CustomWidget[];
      dirty: boolean;
      ghost: CustomLayerDragGhost | null;
      /** The real Touch Bar's own logical pixel size — config-gui has no
       *  on-screen bar of its own, so it needs this to map its window-
       *  relative pointer position into bar-space before sending dragMove. */
      barWidth: number;
      barHeight: number;
    }
  | { type: 'error'; message: string };
