import path from 'path';
import { DrmDisplay, KeyboardReader, renderHot } from 'react-drm';

const keyboard = new KeyboardReader();
const display  = new DrmDisplay(process.argv[2]);

const result = renderHot(path.resolve(__dirname, 'App'), display, {
  dimSecs:        30,
  offSecs:        60,
  pixelShiftSecs: 60,
  keyboardReader: keyboard,
  appProps:       { keyboard },
  activeBrightness:2,
  //  adaptiveBrightness: true
});

function shutdown() {
  try { result.unmount(); } catch {}
  process.kill(process.pid, 'SIGKILL');
}

process.on('SIGINT', shutdown);

// When a game component sets stdin to raw mode, Ctrl+C is delivered as 0x03
// instead of SIGINT. This handler catches it from any layer.
if (process.stdin.isTTY) {
  process.stdin.on('data', (chunk: Buffer) => { if (chunk[0] === 3) shutdown(); });
}
