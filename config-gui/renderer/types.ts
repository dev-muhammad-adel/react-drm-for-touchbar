export type JsonValue = number | string | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type SectionName =
  | 'DISPLAY' | 'ESC_KEY' | 'SLEEP' | 'LAYER_TRANSITION' | 'ACTIVE_WINDOW'
  | 'SCREENSHOT' | 'DOLPHIN' | 'KONSOLE' | 'SYSTEMBAR' | 'CAVA'
  | 'DEFAULT_BROWSER_KEYS' | 'BROWSER_KEY_OVERRIDES'
  | 'DEFAULT_VSCODE_KEYS' | 'VSCODE_KEY_OVERRIDES'
  | 'DOCK' | 'FN_LAYER' | 'FN_KEYS';
export type ConfigData = Partial<Record<SectionName, JsonValue>>;

export interface ConfigApi {
  read: () => Promise<{ data?: ConfigData; error?: string; repoFound: boolean }>;
  write: (changes: ConfigData) => Promise<{ ok: boolean; error?: string }>;
  restart: () => Promise<{ ok: boolean; message: string }>;
  locate: () => Promise<{ found: boolean }>;
  meta: () => Promise<{
    iconChoices: string[];
    domCodeToKeyName: Record<string, string>;
    keyNames: Record<string, number>;
  }>;
  resolveIcon: (name: string) => Promise<string | null>;
  setIconTheme: (theme: string | null) => Promise<void>;
  listApps: () => Promise<DesktopAppEntry[]>;
  listIconThemes: () => Promise<string[]>;
}

export interface DesktopAppEntry {
  name: string;
  command: string;
  args: string[];
  icon: string | null;
}

export interface WindowApi {
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
}

declare global {
  interface Window {
    configApi: ConfigApi;
    windowApi: WindowApi;
  }
}
