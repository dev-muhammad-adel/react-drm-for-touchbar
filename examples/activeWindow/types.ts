export interface ActiveWindow {
  title: string;
  class: string;
  pid:   number;
}

export const EMPTY: ActiveWindow = { title: '', class: '', pid: 0 };

/**
 * A compositor-specific source of active-window changes.
 * start() pushes the initial state and every change; it returns a stop
 * function, or null when this backend isn't available on the system.
 */
export interface ActiveWindowBackend {
  name: string;
  start(push: (w: ActiveWindow) => void): Promise<(() => void) | null>;
}
