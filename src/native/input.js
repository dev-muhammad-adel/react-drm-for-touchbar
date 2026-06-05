"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeyInjector = exports.TouchReader = exports.FKEY_CODES = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function loadNative() {
    const candidates = [
        path_1.default.join(__dirname, '../../build/Release/drm_backend.node'),
        path_1.default.join(__dirname, '../../build/Debug/drm_backend.node'),
    ];
    for (const p of candidates) {
        try {
            return require(p);
        }
        catch (_) { /* try next */ }
    }
    throw new Error('react-drm: native addon not found — run npm run build:native');
}
// F1=59 … F9=67
exports.FKEY_CODES = [59, 60, 61, 62, 63, 64, 65, 66, 67];
// Touch Bar raw axis ranges
const TOUCH_MAX_X = 32767;
const TOUCH_MAX_Y = 127;
// Logical display size (after rotation)
const DISPLAY_W = 2008;
const DISPLAY_H = 60;
function resolveTouchDevicePath(devicePath) {
    if (devicePath)
        return devicePath;
    const envPath = process.env.REACT_DRM_TOUCH_DEVICE_PATH ?? process.env.TOUCH_DEVICE_PATH;
    if (envPath)
        return envPath;
    try {
        const inputDevices = fs_1.default.readFileSync('/proc/bus/input/devices', 'utf8');
        const blocks = inputDevices.trim().split(/\n\n+/);
        for (const block of blocks) {
            if (!/Touch Bar Display Touchpad|Touch Bar/i.test(block))
                continue;
            const match = block.match(/Handlers=.*\b(event\d+)\b/);
            if (match)
                return `/dev/input/${match[1]}`;
        }
    }
    catch (_) {
        // Fall back below.
    }
    return '/dev/input/event9';
}
class TouchReader {
    handle;
    constructor(devicePath) {
        const native = loadNative();
        this.handle = new native.TouchReader(resolveTouchDevicePath(devicePath));
    }
    /**
     * Backward-compatible tap handler — fires only on touch-down.
     * Callback receives touch position in logical display coordinates (0..W-1, 0..H-1).
     */
    start(onTap) {
        this.handle.start((type, rawX, rawY) => {
            if (type !== 0)
                return; // only fire on start (tap)
            const x = Math.round(rawX * (DISPLAY_W - 1) / TOUCH_MAX_X);
            const y = Math.round(rawY * (DISPLAY_H - 1) / TOUCH_MAX_Y);
            onTap(x, y);
        });
    }
    /**
     * Extended gesture handler — provides start, move, end events and
     * automatically detects left/right swipes.
     */
    startWithGestures(opts) {
        const threshold = opts.swipeThreshold ?? 80;
        let startX = 0, startY = 0;
        this.handle.start((type, rawX, rawY) => {
            const x = Math.round(rawX * (DISPLAY_W - 1) / TOUCH_MAX_X);
            const y = Math.round(rawY * (DISPLAY_H - 1) / TOUCH_MAX_Y);
            if (type === 0) { // start
                startX = x;
                startY = y;
                opts.onTouchStart?.(x, y);
            }
            else if (type === 1) { // move
                opts.onTouchMove?.(x, y);
            }
            else if (type === 2) { // end
                opts.onTouchEnd?.(x, y);
                const dx = x - startX;
                if (Math.abs(dx) >= threshold) {
                    if (dx < 0)
                        opts.onSwipeLeft?.(startX, x, y);
                    else
                        opts.onSwipeRight?.(startX, x, y);
                }
            }
        });
    }
    stop() {
        this.handle.stop();
    }
}
exports.TouchReader = TouchReader;
class KeyInjector {
    handle;
    constructor() {
        const native = loadNative();
        this.handle = new native.KeyInjector();
    }
    pressF(n) {
        this.handle.pressKey(exports.FKEY_CODES[n - 1]);
    }
    pressIndex(idx) {
        this.handle.pressKey(exports.FKEY_CODES[idx]);
    }
}
exports.KeyInjector = KeyInjector;
