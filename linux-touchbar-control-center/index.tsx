import fs from 'fs';
import path from 'path';
import { KeyboardReader, PreviewDisplay, createDisplay, renderHot, resolveKeyCode, startPreviewServer, TB_BACKLIGHT_NAMES, DISPLAY_BACKLIGHT_NAMES, TOUCHBAR_DRM_DRIVERS, TOUCHBAR_USB_VENDOR_ID, TOUCHBAR_USB_PRODUCT_ID, TOUCHBAR_USB_BRIDGE } from 'react-drm';
import { DISPLAY, SCREENSHOT, SLEEP, ESC_KEY } from './lib/utils/configLoader';
import { attachTouchBar, ensureTouchBarAttached, watchSleep } from '@/lib/services/suspend';
import { createLogger } from 'react-drm';
import { startCustomLayer } from '@/lib/customLayer';

const log = createLogger('react-drm');

// Show what the resolved .env hardware profile produced. Import-block order
// matters: react-drm loads the repo .env first (src/native/env.ts), so these
// values are the seeded ones, not just the compiled defaults.
log.info('hardware profile:',
  JSON.stringify({
    TB_BACKLIGHT_NAMES,
    DISPLAY_BACKLIGHT_NAMES,
    TOUCHBAR_DRM_DRIVERS,
    USB: `${TOUCHBAR_USB_VENDOR_ID}:${TOUCHBAR_USB_PRODUCT_ID}`,
    TOUCHBAR_USB_BRIDGE,
    BOOT_LOGO: process.env.REACT_DRM_BOOT_LOGO || '(unset)',
  }, null, 2));

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

  // Custom Layer prototype: owns its own widget list + config-gui bridge,
  // entirely separate from config.ts/config.blueprint.ts. Started
  // unconditionally (not preview-only) since config-gui needs a live target
  // to drag onto in normal operation, not just during dev preview.
  // Layer width accounts for the EscKey on wide Touch Bars (same logic as
  // app/layout.tsx's root layout).
  const showEsc = display.width >= ESC_KEY.minWidth && ESC_KEY.onLayers === 'all';
  const layerWidth = showEsc ? display.width - ESC_KEY.width - ESC_KEY.gap : display.width;
  const customLayer = startCustomLayer(layerWidth, display.height);

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
    try { customLayer.stop(); } catch {}
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
