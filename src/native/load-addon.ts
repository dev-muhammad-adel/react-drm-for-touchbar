import fs from 'fs';
import path from 'path';

/**
 * Locate and require <pkgroot>/build/{Release,Debug}/drm_backend.node.
 *
 * Walks up from this module so it works regardless of where the JS runs from:
 *   dev (tsx):      src/native/load-addon.ts      → ../../build
 *   production:     dist/src/native/load-addon.js  → ../../../build
 * The compiled addon always lives at the package root's build/ dir; only the
 * depth from __dirname differs, so we search ancestors instead of hardcoding it.
 */
export function loadAddon(): unknown {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    for (const cfg of ['Release', 'Debug']) {
      const candidate = path.join(dir, 'build', cfg, 'drm_backend.node');
      if (fs.existsSync(candidate)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require(candidate);
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'react-drm: native addon not found.\n' +
    'Run `npm run build:native` first.\n' +
    'You may need libdrm-dev and libcairo2-dev installed.'
  );
}
