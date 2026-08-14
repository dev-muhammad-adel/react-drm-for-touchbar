import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { Project, Node, SyntaxKind } from 'ts-morph';
import * as ts from 'typescript';
import type { ArrayLiteralExpression, ObjectLiteralExpression, SourceFile } from 'ts-morph';
import { KEY } from 'react-drm';
import { CODE_TO_KEY_NAME } from './keyNames';

const SECTION_NAMES = [
  'DISPLAY', 'ESC_KEY', 'SLEEP', 'LAYER_TRANSITION', 'ACTIVE_WINDOW',
  'SCREENSHOT', 'DOLPHIN', 'KONSOLE', 'SYSTEMBAR', 'CAVA',
  'DEFAULT_BROWSER_KEYS', 'BROWSER_KEY_OVERRIDES',
  'DEFAULT_VSCODE_KEYS', 'VSCODE_KEY_OVERRIDES',
  'DOCK', 'FN_LAYER',
] as const;
export type SectionName = typeof SECTION_NAMES[number];

export interface ConfigPaths {
  configPath: string;
  blueprintPath: string;
}

const DEFAULT_REPO_DIR = path.join(os.homedir(), 'react-drm', 'linux-touchbar-control-center');

export function defaultConfigPaths(repoDir: string = DEFAULT_REPO_DIR): ConfigPaths {
  return {
    configPath: path.join(repoDir, 'config.ts'),
    blueprintPath: path.join(repoDir, 'config.blueprint.ts'),
  };
}

/** Seeds config.ts from the blueprint if it doesn't exist yet — same as install.sh's seed_user_config. */
export function ensureConfigExists(paths: ConfigPaths): void {
  if (fs.existsSync(paths.configPath)) return;
  if (!fs.existsSync(paths.blueprintPath)) {
    throw new Error(`blueprint not found at ${paths.blueprintPath} — is the repo path correct?`);
  }
  fs.copyFileSync(paths.blueprintPath, paths.configPath);
}

export type JsonValue = number | string | boolean | JsonValue[] | { [key: string]: JsonValue };
export type ConfigData = Partial<Record<SectionName, JsonValue>>;

/**
 * Converts an AST node to a plain JS value. Returns undefined for anything we
 * don't know how to safely round-trip (function calls, computed template
 * literals, react-icons component references, ...). Callers must OMIT
 * undefined results from the section object — they're never sent to the
 * renderer and never written back, so unsupported source is never touched.
 */
function nodeToValue(node: Node): JsonValue | undefined {
  if (Node.isAsExpression(node)) return nodeToValue(node.getExpression());
  if (Node.isObjectLiteralExpression(node)) {
    const obj: Record<string, JsonValue> = {};
    for (const prop of node.getProperties()) {
      if (!Node.isPropertyAssignment(prop)) continue; // no spreads/methods/shorthand in config.blueprint.ts
      const init = prop.getInitializer();
      if (!init) continue;
      const v = nodeToValue(init);
      if (v !== undefined) obj[prop.getName()] = v;
    }
    return obj;
  }
  if (Node.isArrayLiteralExpression(node)) {
    const arr: JsonValue[] = [];
    for (const el of node.getElements()) {
      const v = nodeToValue(el);
      // One unsupported element taints the whole array — safer to omit the
      // array entirely than silently drop one element out of it.
      if (v === undefined) return undefined;
      arr.push(v);
    }
    return arr;
  }
  if (Node.isNumericLiteral(node)) return node.getLiteralValue();
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralText();
  if (node.getKind() === SyntaxKind.TrueKeyword) return true;
  if (node.getKind() === SyntaxKind.FalseKeyword) return false;
  if (Node.isIdentifier(node) && node.getText() === 'Infinity') return Number.POSITIVE_INFINITY;
  if (Node.isPropertyAccessExpression(node)) {
    const m = /^KEY\.([A-Za-z0-9_]+)$/.exec(node.getText());
    if (m && m[1] in KEY) return (KEY as Record<string, number>)[m[1]];
  }
  return undefined;
}

/** Reads every editable section into a plain-data snapshot for the renderer. */
export function readConfig(configPath: string): ConfigData {
  const project = new Project();
  const sf = project.addSourceFileAtPath(configPath);
  const result: ConfigData = {};
  for (const name of SECTION_NAMES) {
    const init = sf.getVariableDeclaration(name)?.getInitializer();
    if (!init) continue;
    const v = nodeToValue(init);
    if (v === undefined) continue;
    if (name === 'DOCK' && Node.isObjectLiteralExpression(init)) {
      attachDockIconGlyphs(init, v as Record<string, JsonValue>);
    }
    result[name] = v;
  }
  return result;
}

/** DOCK.apps[].icon is a react-icons component reference (unsupported by
 *  nodeToValue) — surfaced separately as a plain string so the icon picker
 *  can show/change it without the generic engine needing to understand JSX. */
function attachDockIconGlyphs(dockNode: ObjectLiteralExpression, dockValue: Record<string, JsonValue>): void {
  const appsProp = dockNode.getProperty('apps');
  if (!appsProp || !Node.isPropertyAssignment(appsProp)) return;
  const appsInit = unwrapArrayLiteral(appsProp.getInitializer());
  if (!appsInit) return;
  const appsValue = dockValue.apps as Record<string, JsonValue>[] | undefined;
  if (!appsValue) return;
  appsInit.getElements().forEach((el, i) => {
    if (!Node.isObjectLiteralExpression(el)) return;
    const iconProp = el.getProperty('icon');
    const init = iconProp && Node.isPropertyAssignment(iconProp) ? iconProp.getInitializer() : undefined;
    if (init && Node.isIdentifier(init) && appsValue[i]) appsValue[i].iconGlyph = init.getText();
  });
}

function isPlainObject(v: JsonValue): v is Record<string, JsonValue> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function safePropName(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function deepEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a as JsonValue) && isPlainObject(b as JsonValue)) {
    const ao = a as Record<string, JsonValue>, bo = b as Record<string, JsonValue>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
    return [...keys].every(k => deepEqual(ao[k], bo[k]));
  }
  return false;
}

function valueToLiteralText(value: JsonValue): string {
  if (typeof value === 'number') return value === Infinity ? 'Infinity' : String(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    const parts = value.map(v => {
      if (typeof v === 'number') {
        const name = CODE_TO_KEY_NAME.get(v);
        return name ? `KEY.${name}` : String(v);
      }
      return valueToLiteralText(v);
    });
    return `[${parts.join(', ')}]`;
  }
  const entries = Object.entries(value).map(([k, v]) => `${safePropName(k)}: ${valueToLiteralText(v)}`);
  return `{ ${entries.join(', ')} }`;
}

/** Patches only the properties present in newValue, one level of nesting at a
 *  time; anything not present (e.g. SCREENSHOT.dir, a comment, DOCK.apps[].icon)
 *  is left completely untouched. */
function mergeObjectProperties(objNode: ObjectLiteralExpression, newValue: Record<string, JsonValue>): void {
  for (const [key, value] of Object.entries(newValue)) {
    const existing = objNode.getProperty(key);
    if (existing && Node.isPropertyAssignment(existing)) {
      const init = existing.getInitializer();
      if (isPlainObject(value) && init && Node.isObjectLiteralExpression(init)) {
        mergeObjectProperties(init, value);
        continue;
      }
      // Forms naturally submit a section's whole current state, not just what
      // the user actually touched — skip fields that didn't really change so
      // an untouched string keeps its original quote style/formatting instead
      // of getting silently reformatted by valueToLiteralText on every save.
      if (init && deepEqual(nodeToValue(init), value)) continue;
      // Some properties carry a load-bearing `as SomeUnion` cast (e.g.
      // FN_LAYER.mode: 'toggle' as 'hold' | 'toggle') that narrows what would
      // otherwise widen to a plain string/number type — replacing the value
      // must keep that cast, not just overwrite the whole initializer.
      const typeNode = init && Node.isAsExpression(init) ? init.getTypeNode() : undefined;
      if (typeNode) {
        existing.setInitializer(`${valueToLiteralText(value)} as ${typeNode.getText()}`);
      } else {
        existing.setInitializer(valueToLiteralText(value));
      }
    } else {
      objNode.addPropertyAssignment({ name: safePropName(key), initializer: valueToLiteralText(value) });
    }
  }
}

function omitKeys(obj: Record<string, JsonValue>, keys: string[]): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(obj)) if (!keys.includes(k)) out[k] = v;
  return out;
}

/** DOCK.apps needs bespoke handling: entries are matched by id so existing
 *  ones are patched in place (preserving their `icon` unless the picker
 *  changed it), new ids are appended, and ids missing from newApps are
 *  dropped (the user removed that dock entry). */
function mergeDockApps(
  dockNode: ObjectLiteralExpression,
  newApps: Record<string, JsonValue>[],
  newIconNames: Set<string>,
): void {
  const appsProp = dockNode.getProperty('apps');
  const existingArray = appsProp && Node.isPropertyAssignment(appsProp)
    ? unwrapArrayLiteral(appsProp.getInitializer()) : undefined;
  const existingElements = existingArray ? existingArray.getElements() : [];
  // Preserve a cast on the array itself (e.g. `] as DockApp[]`) across the rewrite.
  const arrayCastType = appsProp && Node.isPropertyAssignment(appsProp)
    ? asExpressionTypeText(appsProp.getInitializer()) : undefined;

  const existingIds: (string | undefined)[] = [];
  const existingById = new Map<string, ObjectLiteralExpression>();
  for (const el of existingElements) {
    if (!Node.isObjectLiteralExpression(el)) { existingIds.push(undefined); continue; }
    const idProp = el.getProperty('id');
    const init = idProp && Node.isPropertyAssignment(idProp) ? idProp.getInitializer() : undefined;
    const id = init && Node.isStringLiteral(init) ? init.getLiteralValue() : undefined;
    existingIds.push(id);
    if (id) existingById.set(id, el);
  }

  // Same ids in the same order as before? If every element is also unchanged,
  // the whole array can be left untouched (original whitespace and all)
  // instead of getting rebuilt with our own indentation.
  const newIds = newApps.map(a => a.id as string);
  const sameOrder = existingIds.length === newIds.length && existingIds.every((id, i) => id === newIds[i]);
  let anyElementChanged = false;

  const parts: string[] = [];
  for (const app of newApps) {
    const id = app.id as string;
    const iconGlyph = app.iconGlyph as string | undefined;
    const rest = omitKeys(app, ['iconGlyph']);
    const existing = existingById.get(id);

    if (existing) {
      const beforeText = existing.getText();
      mergeObjectProperties(existing, rest);
      const iconProp = existing.getProperty('icon');
      const currentIconText = iconProp && Node.isPropertyAssignment(iconProp)
        ? iconProp.getInitializer()?.getText() : undefined;
      if (iconGlyph && iconGlyph !== currentIconText) {
        if (iconProp && Node.isPropertyAssignment(iconProp)) iconProp.setInitializer(iconGlyph);
        else existing.addPropertyAssignment({ name: 'icon', initializer: iconGlyph });
        newIconNames.add(iconGlyph);
      }
      if (existing.getText() !== beforeText) anyElementChanged = true;
      parts.push(existing.getText());
    } else {
      anyElementChanged = true;
      const entries = Object.entries(rest).map(([k, v]) => `${safePropName(k)}: ${valueToLiteralText(v)}`);
      if (iconGlyph) { entries.push(`icon: ${iconGlyph}`); newIconNames.add(iconGlyph); }
      parts.push(`{ ${entries.join(', ')} }`);
    }
  }

  if (sameOrder && !anyElementChanged) return; // true no-op — leave the array's own formatting untouched

  const arraySuffix = arrayCastType ? ` as ${arrayCastType}` : '';
  const newArrayText = `[\n    ${parts.join(',\n    ')},\n  ]${arraySuffix}`;
  if (appsProp && Node.isPropertyAssignment(appsProp)) appsProp.setInitializer(newArrayText);
  else dockNode.addPropertyAssignment({ name: 'apps', initializer: newArrayText });
}

/** Unwraps a `{...} as const`-style section initializer down to the actual
 *  object literal, without touching the `as const` cast itself. */
function unwrapObjectLiteral(node: Node | undefined): ObjectLiteralExpression | undefined {
  if (!node) return undefined;
  if (Node.isAsExpression(node)) return unwrapObjectLiteral(node.getExpression());
  return Node.isObjectLiteralExpression(node) ? node : undefined;
}

/** Same idea as unwrapObjectLiteral, for a `[...] as SomeType[]`-style array. */
function unwrapArrayLiteral(node: Node | undefined): ArrayLiteralExpression | undefined {
  if (!node) return undefined;
  if (Node.isAsExpression(node)) return unwrapArrayLiteral(node.getExpression());
  return Node.isArrayLiteralExpression(node) ? node : undefined;
}

/** If node is a `<value> as <Type>` cast, returns "Type" as text; else undefined. */
function asExpressionTypeText(node: Node | undefined): string | undefined {
  return node && Node.isAsExpression(node) ? node.getTypeNode()?.getText() : undefined;
}

function ensureFa6Imports(sf: SourceFile, iconNames: Set<string>): void {
  if (iconNames.size === 0) return;
  let importDecl = sf.getImportDeclaration(d => d.getModuleSpecifierValue() === 'react-icons/fa6');
  if (!importDecl) importDecl = sf.addImportDeclaration({ moduleSpecifier: 'react-icons/fa6', namedImports: [] });
  const existing = new Set(importDecl.getNamedImports().map(ni => ni.getName()));
  for (const name of iconNames) if (!existing.has(name)) importDecl.addNamedImport(name);
}

/** Applies changes for whichever sections are present in `changes`, leaving
 *  every other section (and all comments/types/functions) untouched. */
export function writeConfig(configPath: string, changes: ConfigData): void {
  const project = new Project();
  const sf = project.addSourceFileAtPath(configPath);
  const newIconNames = new Set<string>();

  for (const name of SECTION_NAMES) {
    const newValue = changes[name];
    if (newValue === undefined || !isPlainObject(newValue)) continue;
    const init = unwrapObjectLiteral(sf.getVariableDeclaration(name)?.getInitializer());
    if (!init) continue;

    if (name === 'DOCK') {
      const apps = newValue.apps;
      if (Array.isArray(apps)) mergeDockApps(init, apps as Record<string, JsonValue>[], newIconNames);
      mergeObjectProperties(init, omitKeys(newValue, ['apps']));
    } else {
      mergeObjectProperties(init, newValue);
    }
  }

  ensureFa6Imports(sf, newIconNames);
  sf.saveSync(); // config.ts itself is safely on disk from here on

  // Best-effort: dist/config.js only matters for production (node dist/index.js),
  // and a failure here (e.g. an unwritable dist/) must never be reported as the
  // save itself having failed — config.ts already saved correctly above.
  try {
    syncCompiledConfig(configPath);
  } catch (e) {
    console.error('[config-gui] config.ts saved, but refreshing dist/config.js failed:', e);
  }
}

/**
 * After saving config.ts, also refreshes dist/config.js — the compiled file
 * `node dist/index.js` (production / the systemd service) actually requires.
 * Without this, "Restart" would just reload the same stale compiled config
 * from whenever `npm run build` last ran. A single-file transpile (no
 * type-checking, no project-wide build) keeps Save fast.
 */
function syncCompiledConfig(configPath: string): void {
  const dir = path.dirname(configPath);
  const distDir = path.join(dir, 'dist');
  if (!fs.existsSync(distDir)) return; // no prior build — nothing to keep in sync

  const source = fs.readFileSync(configPath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: configPath,
  });

  const outFile = path.join(distDir, `${path.basename(configPath, '.ts')}.js`);
  fs.writeFileSync(outFile, output.outputText);
}

export function restartService(): Promise<{ ok: boolean; message: string }> {
  return new Promise(resolve => {
    exec('systemctl --user restart react-drm.service', (err, _stdout, stderr) => {
      if (err) resolve({ ok: false, message: stderr.trim() || err.message });
      else resolve({ ok: true, message: 'react-drm restarted' });
    });
  });
}
