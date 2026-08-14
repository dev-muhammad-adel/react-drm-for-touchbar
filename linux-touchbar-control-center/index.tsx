import fs from 'fs';
import path from 'path';
import { KeyboardReader, PreviewDisplay, createDisplay, renderHot, resolveKeyCode, startPreviewServer } from 'react-drm';
import { DISPLAY, SCREENSHOT, SLEEP } from './lib/utils/configLoader';
import { attachTouchBar, ensureTouchBarAttached, watchSleep } from '@/lib/services/suspend';
import { createLogger } from 'react-drm';

const log = createLogger('react-drm');

// The app owns the Touch Bar lifecycle in every run mode — manual `npm run
// dev` and react-drm.service alike: attach at startup, quiesce before system
// sleep, re-attach + resume after. SLEEP.enabled in config.ts turns it off.
// None of this applies to the browser preview backend — there's no physical
// Touch Bar to attach/detach, and waiting on one would just stall startup.
const isPreview = process.env.REACT_DRM_BACKEND === 'preview';

async function main() {
  if (SLEEP.enabled && !isPreview) {
    await ensureTouchBarAttached().catch(e => {
      log.warn('Touch Bar attach failed:', e instanceof Error ? e.message : e);
    });
  }

  const keyboard = new KeyboardReader();
  const display  = createDisplay(process.argv[2]);

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
      log.info(`screenshot saved: ${file}`);
    } catch (e) {
      log.error('screenshot failed:', e instanceof Error ? e.message : e);
    }
  });

  const result = renderHot(path.resolve(__dirname, 'App'), display, {
    dimSecs:          DISPLAY.dimSecs,
    offSecs:          DISPLAY.offSecs,
    pixelShiftSecs:   DISPLAY.pixelShiftSecs,
    keyboardReader:   keyboard,
    appProps:         { keyboard },
    activeBrightness: DISPLAY.activeBrightness,
    flushFps:         DISPLAY.flushFps,
    partialFlush:     DISPLAY.partialFlush,
    touchEnabled:     !isPreview,
    //  adaptiveBrightness: true
  });

  if (SLEEP.enabled && !isPreview) {
    watchSleep({
      onSleep: () => result.suspend(),
      onResume: async () => {
        await attachTouchBar();
        // KeyboardReader already auto-reconnects on device loss. Forcing a
        // fresh udev enumeration here races the BCE/T2 resume path and can
        // abort inside libudev before the input tree is stable again.
        result.resume();
      },
    }).catch(e => {
      log.warn('sleep watcher unavailable:', e instanceof Error ? e.message : e);
    });
  }

  if (isPreview) {
    startPreviewServer(display as PreviewDisplay, result);
  }

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
}

main().catch(e => {
  log.error('startup failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
