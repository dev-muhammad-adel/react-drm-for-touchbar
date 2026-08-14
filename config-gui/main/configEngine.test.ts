import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readConfig, writeConfig } from './configEngine';
import type { JsonValue } from './configEngine';

const BLUEPRINT = path.join(__dirname, '..', '..', 'linux-touchbar-control-center', 'config.blueprint.ts');

function withFixture(run: (configPath: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-engine-test-'));
  const configPath = path.join(dir, 'config.ts');
  fs.copyFileSync(BLUEPRINT, configPath);
  try {
    run(configPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('true no-op read+write produces a byte-identical file', () => {
  withFixture(configPath => {
    const before = fs.readFileSync(configPath, 'utf8');
    const all = readConfig(configPath);
    writeConfig(configPath, all);
    const after = fs.readFileSync(configPath, 'utf8');
    assert.equal(after, before);
  });
});

test('editing one DISPLAY field leaves siblings and comments untouched', () => {
  withFixture(configPath => {
    const before = readConfig(configPath);
    const display = before.DISPLAY as Record<string, unknown>;
    writeConfig(configPath, { DISPLAY: { ...display, dimSecs: 999 } });
    const after = readConfig(configPath);
    assert.equal((after.DISPLAY as Record<string, unknown>).dimSecs, 999);
    assert.equal((after.DISPLAY as Record<string, unknown>).offSecs, display.offSecs);
    const text = fs.readFileSync(configPath, 'utf8');
    assert.match(text, /partialFlush:\s*false,\s*\/\/ true = not ready yet/);
  });
});

test('SCREENSHOT.dir (a computed template literal) survives editing SCREENSHOT.keys', () => {
  withFixture(configPath => {
    const before = readConfig(configPath);
    writeConfig(configPath, { SCREENSHOT: { keys: ['ctrl', 'alt', 'x'] } });
    const text = fs.readFileSync(configPath, 'utf8');
    assert.match(text, /dir:\s*`\$\{picturesDir\}\/touchbar`/);
    const after = readConfig(configPath);
    assert.deepEqual((after.SCREENSHOT as Record<string, unknown>).keys, ['ctrl', 'alt', 'x']);
  });
});

test('keycode arrays round-trip through named KEY constants, not raw numbers', () => {
  withFixture(configPath => {
    writeConfig(configPath, { DEFAULT_BROWSER_KEYS: { reload: [56, 19] } }); // LEFTALT, KEY_R
    const text = fs.readFileSync(configPath, 'utf8');
    assert.match(text, /reload:\s*\[KEY\.LEFTALT, KEY\.KEY_R\]/);
    const after = readConfig(configPath);
    assert.deepEqual((after.DEFAULT_BROWSER_KEYS as Record<string, unknown>).reload, [56, 19]);
  });
});

test('as const and as Type casts are preserved after editing', () => {
  withFixture(configPath => {
    const before = readConfig(configPath);
    writeConfig(configPath, { FN_LAYER: { ...(before.FN_LAYER as object), longMs: 500 } });
    const text = fs.readFileSync(configPath, 'utf8');
    assert.match(text, /mode:\s*'toggle' as 'hold' \| 'toggle'/);
    assert.match(text, /DISPLAY = \{[\s\S]*?\} as const;/); // untouched section keeps its cast
  });
});

test('DOCK.apps: existing app patched by id keeps unedited fields and formatting', () => {
  withFixture(configPath => {
    const before = readConfig(configPath);
    const apps = (before.DOCK as Record<string, JsonValue>).apps as Record<string, JsonValue>[];
    writeConfig(configPath, {
      DOCK: { ...(before.DOCK as object), apps: [{ ...apps[0], iconGlyph: 'FaFolderOpen' }] },
    });
    const text = fs.readFileSync(configPath, 'utf8');
    assert.match(text, /id: 'files'/); // original quoting preserved — wasn't touched
    assert.match(text, /icon: FaFolderOpen/);
    assert.match(text, /\] as DockApp\[\]/); // array cast preserved
    const after = readConfig(configPath);
    const afterApps = (after.DOCK as Record<string, JsonValue>).apps as Record<string, JsonValue>[];
    assert.equal(afterApps.length, 1);
    assert.equal(afterApps[0].iconGlyph, 'FaFolderOpen');
  });
});

test('DOCK.apps: adding a new icon adds the react-icons import, without duplicating existing ones', () => {
  withFixture(configPath => {
    const before = readConfig(configPath);
    const apps = (before.DOCK as Record<string, JsonValue>).apps as Record<string, JsonValue>[];
    writeConfig(configPath, {
      DOCK: {
        ...(before.DOCK as object),
        apps: [...apps, { id: 'spotify', label: 'Spotify', iconGlyph: 'FaSpotify', color: '#1db954', command: 'spotify' }],
      },
    });
    const text = fs.readFileSync(configPath, 'utf8');
    const importLine = text.split('\n').find((l: string) => l.includes("from 'react-icons/fa6'"))!;
    assert.match(importLine, /FaSpotify/);
    assert.equal((importLine.match(/FaFolder\b/g) ?? []).length, 1); // not duplicated
  });
});

test('a dist/config.js sync failure does not mask a successful config.ts save', () => {
  withFixture(configPath => {
    const distDir = path.join(path.dirname(configPath), 'dist');
    // Make the sync target unwritable (a directory where a file is expected)
    // so syncCompiledConfig is guaranteed to throw.
    fs.mkdirSync(path.join(distDir, 'config.js'), { recursive: true });

    assert.doesNotThrow(() => writeConfig(configPath, { DISPLAY: { dimSecs: 333 } }));

    const after = readConfig(configPath);
    assert.equal((after.DISPLAY as Record<string, unknown>).dimSecs, 333);
  });
});

test('writeConfig does nothing to dist/ when no prior build exists', () => {
  withFixture(configPath => {
    writeConfig(configPath, { DISPLAY: { dimSecs: 111 } });
    const distDir = path.join(path.dirname(configPath), 'dist');
    assert.equal(fs.existsSync(distDir), false);
  });
});

test('writeConfig refreshes dist/config.js so production (node dist/index.js) sees the new value too', () => {
  withFixture(configPath => {
    const distDir = path.join(path.dirname(configPath), 'dist');
    fs.mkdirSync(distDir);
    fs.writeFileSync(path.join(distDir, 'config.js'), '"use strict";\nexports.DISPLAY = { dimSecs: 1 };\n');

    writeConfig(configPath, { DISPLAY: { dimSecs: 222 } });

    const compiledText = fs.readFileSync(path.join(distDir, 'config.js'), 'utf8');
    assert.match(compiledText, /dimSecs:\s*222/);
    assert.match(compiledText, /"use strict"/); // real CommonJS output, not a raw copy of config.ts
    assert.match(compiledText, /require\(["']react-drm["']\)/); // KEY import compiled, not left as ESM
  });
});
