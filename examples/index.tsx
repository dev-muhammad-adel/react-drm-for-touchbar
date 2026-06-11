import fs from 'fs';
import path from 'path';
import { DrmDisplay, KeyboardReader, renderHot, resolveKeyCode } from 'react-drm';
import { DISPLAY, SCREENSHOT } from './config';

const keyboard = new KeyboardReader();
const display  = new DrmDisplay(process.argv[2]);

// Save what the touchbar currently shows as a PNG when all combo keys are
// held. Fires once per press — re-arms only after a combo key is released.
const screenshotCodes = SCREENSHOT.keys.map(resolveKeyCode);
const heldCodes = new Set<number>();
let screenshotArmed = true;
keyboard.onKey((code, value) => {
  if (!screenshotCodes.includes(code)) return;
  if (value === 0) { heldCodes.delete(code); screenshotArmed = true; return; }
  heldCodes.add(code);
  if (!screenshotArmed || !screenshotCodes.every(c => heldCodes.has(c))) return;
  screenshotArmed = false;
  try {
    fs.mkdirSync(SCREENSHOT.dir, { recursive: true });
    const file = path.join(SCREENSHOT.dir, `touchbar-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
    display.screenshot(file);
    console.log(`[react-drm] screenshot saved: ${file}`);
  } catch (e) {
    console.error('[react-drm] screenshot failed:', e instanceof Error ? e.message : e);
  }
});

const result = renderHot(path.resolve(__dirname, 'App'), display, {
  dimSecs:          DISPLAY.dimSecs,
  offSecs:          DISPLAY.offSecs,
  pixelShiftSecs:   DISPLAY.pixelShiftSecs,
  keyboardReader:   keyboard,
  appProps:         { keyboard },
  activeBrightness: DISPLAY.activeBrightness,
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
