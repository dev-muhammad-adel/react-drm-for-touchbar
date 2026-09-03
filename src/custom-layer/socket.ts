import os from 'node:os';
import path from 'node:path';

/**
 * Local-only IPC between config-gui's main process and the Touch Bar
 * process's Custom Layer bridge — a Unix domain socket rather than a TCP
 * port, since neither side needs to be reachable off-machine. XDG_RUNTIME_DIR
 * is per-user and tmpfs-backed (cleaned up on logout); os.tmpdir() covers
 * environments where it isn't set.
 */
export function customLayerSocketPath(): string {
  const runtimeDir = process.env.XDG_RUNTIME_DIR || os.tmpdir();
  return path.join(runtimeDir, 'react-drm-custom-layer.sock');
}

/** Encodes one message as a newline-delimited JSON frame. */
export function encodeMessage(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}

/**
 * Buffers arbitrary chunk boundaries back into whole newline-delimited JSON
 * messages. Returns a function to feed chunks into; parsed messages are
 * reported via onMessage as they complete. Malformed lines are dropped
 * rather than tearing down the connection.
 */
export function createMessageReader<T>(onMessage: (message: T) => void): (chunk: Buffer | string) => void {
  let buffer = '';
  return (chunk: Buffer | string) => {
    buffer += chunk.toString('utf8');
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      try {
        onMessage(JSON.parse(line) as T);
      } catch {
        // Ignore a malformed frame rather than dropping the connection.
      }
    }
  };
}
