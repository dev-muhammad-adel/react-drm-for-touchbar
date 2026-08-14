/**
 * Structured, scoped console logger. Fancy (colored, dotted, column-aligned)
 * when stdout is a real TTY (`npm run dev`); plain aligned text with no
 * escape codes when it isn't (systemd/journald has no TTY, and raw ANSI
 * codes would show up as garbage in `journalctl`).
 *
 * debug/info go through console.log (stdout), warn/error through
 * console.warn/console.error (stderr) — journald assigns log priority based
 * on which stream a service writes to, so this keeps `journalctl -p warning`
 * filtering meaningful even in the non-TTY fallback.
 *
 * DEBUG is silent unless REACT_DRM_LOG_LEVEL=debug (mirrors the existing
 * REACT_DRM_PROFILE / DRM_DAMAGE_LOG env-flag convention).
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const COLOR = {
  reset:  '\x1b[0m',
  dim:    '\x1b[2m',
  bold:   '\x1b[1m',
  gray:   '\x1b[90m',
  cyan:   '\x1b[36m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
} as const;

const LEVEL_STYLE: Record<Level, { label: string; color: string }> = {
  debug: { label: 'DEBUG', color: COLOR.gray },
  info:  { label: 'INFO ', color: COLOR.cyan },
  warn:  { label: 'WARN ', color: COLOR.yellow },
  error: { label: 'ERROR', color: COLOR.bold + COLOR.red },
};

const SCOPE_WIDTH = 12;
const fancy = process.stdout.isTTY === true;
const debugEnabled = process.env.REACT_DRM_LOG_LEVEL === 'debug';

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8); // HH:MM:SS
}

function paint(text: string, color: string): string {
  return fancy ? `${color}${text}${COLOR.reset}` : text;
}

function emit(scope: string, level: Level, args: unknown[]): void {
  if (level === 'debug' && !debugEnabled) return;

  const { label, color } = LEVEL_STYLE[level];
  const dot = paint('●', color);
  const levelText = paint(label, color);
  const scopeText = paint(scope.padEnd(SCOPE_WIDTH), COLOR.dim);
  const time = paint(timestamp(), COLOR.dim);

  const line = `[${time}] ${dot} ${levelText} ${scopeText}`;
  const write = level === 'debug' || level === 'info' ? console.log : console.error;
  write(line, ...args);
}

export type Logger = {
  debug: (...args: unknown[]) => void;
  info:  (...args: unknown[]) => void;
  warn:  (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export function createLogger(scope: string): Logger {
  return {
    debug: (...args) => emit(scope, 'debug', args),
    info:  (...args) => emit(scope, 'info', args),
    warn:  (...args) => emit(scope, 'warn', args),
    error: (...args) => emit(scope, 'error', args),
  };
}
