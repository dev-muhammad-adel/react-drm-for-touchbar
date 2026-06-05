import path from 'path';
import { DrmDisplay, renderHot } from 'react-drm';

const device = process.argv[2] ?? '/dev/dri/card1';

const display = new DrmDisplay(device);
const result  = renderHot(path.resolve(__dirname, 'App'), display, {
  dimSecs:        30,  // dim to 35% brightness after 30 s idle
  offSecs:        60,  // blank screen 60 s after dim
  pixelShiftSecs: 60,  // orbit ±2 px every 60 s to spread AMOLED wear
});

process.on('SIGINT', () => { result.unmount(); display.close(); process.exit(0); });
