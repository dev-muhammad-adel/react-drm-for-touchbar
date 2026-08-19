import type { ConfigData, DesktopAppEntry, JsonValue, SectionName } from './types';

let state: ConfigData = {};
let iconChoices: string[] = [];
let domCodeToKeyName: Record<string, string> = {};
let keyNames: Record<string, number> = {};
let codeToKeyName: Record<number, string> = {};
let desktopAppsCache: DesktopAppEntry[] | null = null;
let dirty = false;

interface NavGroup {
  label: string;
  sections: SectionName[];
}

const NAV_GROUPS: NavGroup[] = [
  { label: 'Display & Power', sections: ['DISPLAY', 'SLEEP', 'LAYER_TRANSITION'] },
  { label: 'Dock', sections: ['DOCK'] },
  {
    label: 'Keyboard Shortcuts',
    sections: ['DEFAULT_BROWSER_KEYS', 'BROWSER_KEY_OVERRIDES', 'DEFAULT_VSCODE_KEYS', 'VSCODE_KEY_OVERRIDES'],
  },
  {
    label: 'Panels',
    sections: ['ESC_KEY', 'ACTIVE_WINDOW', 'SCREENSHOT', 'DOLPHIN', 'KONSOLE', 'SYSTEMBAR', 'CAVA', 'FN_LAYER', 'FN_KEYS'],
  },
];

const SECTION_ORDER: SectionName[] = NAV_GROUPS.flatMap(g => g.sections);

const SECTION_LABELS: Record<SectionName, string> = {
  DISPLAY: 'Display', SLEEP: 'Sleep', DOCK: 'Dock',
  DEFAULT_BROWSER_KEYS: 'Browser Keys', BROWSER_KEY_OVERRIDES: 'Browser Overrides',
  DEFAULT_VSCODE_KEYS: 'VS Code Keys', VSCODE_KEY_OVERRIDES: 'VS Code Overrides',
  ESC_KEY: 'Esc Key', ACTIVE_WINDOW: 'Active Window', SCREENSHOT: 'Screenshot',
  LAYER_TRANSITION: 'Transitions', DOLPHIN: 'Dolphin', KONSOLE: 'Konsole',
  SYSTEMBAR: 'System Bar', CAVA: 'Audio Visualizer', FN_LAYER: 'Fn Layer', FN_KEYS: 'Fn Keys',
};

const SECTION_DESCRIPTIONS: Record<SectionName, string> = {
  DISPLAY: 'Screen timing and brightness',
  SLEEP: 'Touch Bar behavior around system sleep',
  LAYER_TRANSITION: 'Timing for switching between layers',
  DOCK: "Pinned apps and the dock's appearance",
  DEFAULT_BROWSER_KEYS: 'Shortcuts sent to any browser window',
  BROWSER_KEY_OVERRIDES: 'Per-browser shortcut overrides',
  DEFAULT_VSCODE_KEYS: 'Shortcuts sent to any VS Code window',
  VSCODE_KEY_OVERRIDES: 'Per-editor shortcut overrides',
  ESC_KEY: 'The on-screen Esc key for wide Touch Bars',
  ACTIVE_WINDOW: 'How the focused window is detected',
  SCREENSHOT: 'Touch Bar screenshot shortcut',
  DOLPHIN: 'Dolphin file manager panel',
  KONSOLE: 'Konsole terminal panel',
  SYSTEMBAR: 'CPU, memory, and network stats',
  CAVA: 'Audio visualizer bars',
  FN_LAYER: 'How the Fn key reaches the F-key layer',
  FN_KEYS: 'Extra keys shown after F1–F12 in the Fn-key layer',
};

const BROWSER_ACTIONS = ['back', 'forward', 'reload', 'home', 'newTab', 'closeTab', 'nextTab', 'prevTab'];
const VSCODE_ACTIONS = [
  'back', 'forward', 'prevEditor', 'nextEditor', 'toggleSidebar', 'toggleTerminal',
  'run', 'stop', 'stepOver', 'stepInto', 'stepOut', 'undo', 'redo', 'find', 'replace',
  'commandPalette', 'settings',
];

const UNION_FIELDS: Record<string, string[]> = {
  'ESC_KEY.onLayers': ['all', 'fn'],
  'ACTIVE_WINDOW.backend': ['auto', 'hyprland', 'niri', 'gnome', 'plasma', 'xorg'],
  'FN_LAYER.mode': ['hold', 'toggle', 'double-tap'],
};

function isPlainObject(v: JsonValue): v is Record<string, JsonValue> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function humanize(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
}

function keyNameFor(code: number): string {
  return codeToKeyName[code] ?? String(code);
}

function setPath(path: string[], value: JsonValue): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let obj: any = state;
  for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
  obj[path[path.length - 1]] = value;
}

/** Picking the same app twice, or adding two unrenamed "custom" apps, would
 *  otherwise both land on the same slug — two dock entries sharing an id
 *  both write out as literal duplicates (and break React's key uniqueness
 *  on the real Touch Bar). Append -2, -3, ... until it's actually unique. */
function uniqueAppId(base: string, existing: Record<string, JsonValue>[]): string {
  const taken = new Set(existing.map(a => a.id as string));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function markDirty(): void {
  dirty = true;
  const status = document.getElementById('status')!;
  status.textContent = 'Unsaved changes';
  status.className = '';
  refreshDockPreview();
}

let dockPreviewEl: HTMLElement | null = null;

function refreshDockPreview(): void {
  const dock = state.DOCK;
  if (!dockPreviewEl || dock === undefined || !isPlainObject(dock)) return;
  void renderDockPreview(dockPreviewEl, dock);
}

/**
 * Renders the Dock's pinned apps in the Touch Bar's true 2008:60 aspect
 * ratio, using the live config values (panel color/radius, icon size, gap,
 * indicator color/size) — every dimension here is a percentage derived from
 * the real hardware dimensions, so this is a proportional live rendering of
 * the current settings, not a rough mockup.
 */
async function renderDockPreview(container: HTMLElement, dock: Record<string, JsonValue>): Promise<void> {
  const apps = (dock.apps as Record<string, JsonValue>[] | undefined) ?? [];
  const panel = isPlainObject(dock.panel) ? dock.panel : {};
  const indicator = isPlainObject(dock.indicator) ? dock.indicator : {};
  const iconSize = typeof dock.iconSize === 'number' ? dock.iconSize : 50;
  const gap = typeof dock.gap === 'number' ? dock.gap : 14;
  const indicatorSize = typeof indicator.size === 'number' ? indicator.size : 5;

  container.style.background = typeof panel.color === 'string' ? panel.color : '#1c1f26';
  const radiusPx = typeof panel.radius === 'number' ? panel.radius : 20;
  container.style.borderRadius = `${Math.min(16, radiusPx / 3)}px`;
  container.style.gap = `${(gap / 2008) * 100}%`;

  const resolved = await Promise.all(apps.map(async (a, i) => {
    const iconName = typeof a.iconName === 'string' ? a.iconName : undefined;
    const url = iconName ? await window.configApi.resolveIcon(iconName) : null;
    return { app: a, url, showIndicator: i === 0 };
  }));

  container.innerHTML = '';
  if (resolved.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'tb-preview-empty';
    empty.textContent = 'No pinned apps yet';
    container.appendChild(empty);
    return;
  }

  for (const { app, url, showIndicator } of resolved) {
    const wrap = document.createElement('div');
    wrap.className = 'tb-icon-wrap';

    const shape = document.createElement('div');
    shape.className = 'tb-icon-shape';
    shape.style.height = `${(iconSize / 60) * 100}%`;
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = typeof app.label === 'string' ? app.label : '';
      shape.appendChild(img);
    } else {
      const mono = document.createElement('div');
      mono.className = 'tb-icon-mono';
      mono.style.background = typeof app.color === 'string' ? app.color : '#7dd3fc';
      const label = typeof app.label === 'string' ? app.label : '?';
      mono.textContent = label.charAt(0).toUpperCase();
      shape.appendChild(mono);
    }
    wrap.appendChild(shape);

    // Every icon reserves the same dot space, visible or not, so icons stay
    // vertically aligned regardless of which app happens to show one.
    const dot = document.createElement('span');
    dot.className = 'tb-indicator';
    dot.style.width = `${(indicatorSize / 60) * 100}%`;
    dot.style.height = dot.style.width;
    dot.style.background = showIndicator && typeof indicator.color === 'string' ? indicator.color : 'transparent';
    dot.style.boxShadow = showIndicator ? '' : 'none';
    wrap.appendChild(dot);

    container.appendChild(wrap);
  }
}

function wireWindowControls(): void {
  document.getElementById('win-minimize')!.addEventListener('click', () => window.windowApi.minimize());
  document.getElementById('win-maximize')!.addEventListener('click', () => window.windowApi.toggleMaximize());
  document.getElementById('win-close')!.addEventListener('click', () => window.windowApi.close());
}

async function main(): Promise<void> {
  const meta = await window.configApi.meta();
  iconChoices = meta.iconChoices;
  domCodeToKeyName = meta.domCodeToKeyName;
  keyNames = meta.keyNames;
  codeToKeyName = {};
  for (const [name, code] of Object.entries(keyNames)) codeToKeyName[code] = name;

  const res = await window.configApi.read();
  if (!res.repoFound) return showEmptyState();
  if (res.error) return showError(res.error);
  state = JSON.parse(JSON.stringify(res.data ?? {}));

  buildNav();
  renderAllSections();
  showTab(SECTION_ORDER.find(n => state[n] !== undefined) ?? SECTION_ORDER[0]);
  wireTopbar();
  wireSearch();
}

function showEmptyState(): void {
  document.getElementById('nav')!.innerHTML = '';
  (document.getElementById('search-wrap') as HTMLElement).style.display = 'none';
  document.getElementById('content')!.innerHTML =
    '<div class="empty-state">Couldn\'t find linux-touchbar-control-center at the default install path.'
    + '<br/><button id="locate-btn" style="margin-top:14px;">Locate folder…</button></div>';
  document.getElementById('locate-btn')!.addEventListener('click', async () => {
    await window.configApi.locate();
    main();
  });
}

function showError(msg: string): void {
  document.getElementById('content')!.innerHTML =
    `<div class="empty-state">Couldn't read config.ts:<br/><code>${escapeHtml(msg)}</code></div>`;
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function buildNav(): void {
  const nav = document.getElementById('nav')!;
  nav.innerHTML = '';
  for (const group of NAV_GROUPS) {
    const sectionsPresent = group.sections.filter(name => state[name] !== undefined);
    if (sectionsPresent.length === 0) continue;

    const groupEl = document.createElement('div');
    groupEl.className = 'nav-group';
    const groupLabel = document.createElement('div');
    groupLabel.className = 'nav-group-label';
    groupLabel.textContent = group.label;
    groupEl.appendChild(groupLabel);

    for (const name of sectionsPresent) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-item';
      btn.textContent = SECTION_LABELS[name];
      btn.dataset.section = name;
      btn.addEventListener('click', () => showTab(name));
      groupEl.appendChild(btn);
    }
    nav.appendChild(groupEl);
  }
}

function wireSearch(): void {
  const input = document.getElementById('search-input') as HTMLInputElement;
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll<HTMLElement>('.nav-item').forEach(btn => {
      const matches = q.length === 0 || (btn.textContent?.toLowerCase().includes(q) ?? false);
      btn.classList.toggle('hidden', !matches);
    });
    document.querySelectorAll<HTMLElement>('.nav-group').forEach(group => {
      const anyVisible = [...group.querySelectorAll('.nav-item')]
        .some(el => !el.classList.contains('hidden'));
      group.style.display = anyVisible ? '' : 'none';
    });
  });
}

function showTab(name: SectionName): void {
  document.querySelectorAll<HTMLElement>('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.section === name);
  });
  document.querySelectorAll('.section-panel').forEach(p => {
    p.classList.toggle('active', p.id === `panel-${name}`);
  });
  document.getElementById('content')!.classList.toggle('wide', name === 'DOCK');
}

function renderAllSections(): void {
  const content = document.getElementById('content')!;
  content.innerHTML = '';
  for (const name of SECTION_ORDER) {
    if (state[name] === undefined) continue;
    const panel = document.createElement('div');
    panel.className = 'section-panel';
    panel.id = `panel-${name}`;

    const header = document.createElement('div');
    header.className = 'section-header';
    const title = document.createElement('h2');
    title.className = 'section-title';
    title.textContent = SECTION_LABELS[name];
    const desc = document.createElement('p');
    desc.className = 'section-desc';
    desc.textContent = SECTION_DESCRIPTIONS[name];
    header.append(title, desc);
    panel.appendChild(header);

    content.appendChild(panel);
    renderSection(name, panel);
  }
}

function renderSection(name: SectionName, panel: HTMLElement): void {
  const value = state[name];
  if (value === undefined || !isPlainObject(value)) return;
  switch (name) {
    case 'DOCK': return renderDock(panel, value);
    case 'DEFAULT_BROWSER_KEYS': return renderKeymap(panel, name, value, BROWSER_ACTIONS);
    case 'DEFAULT_VSCODE_KEYS': return renderKeymap(panel, name, value, VSCODE_ACTIONS);
    case 'BROWSER_KEY_OVERRIDES': return renderOverrides(panel, name, value, BROWSER_ACTIONS);
    case 'VSCODE_KEY_OVERRIDES': return renderOverrides(panel, name, value, VSCODE_ACTIONS);
    case 'FN_KEYS': return renderFnKeys(panel, value);
    default: return renderGenericObject(panel, value, [name]);
  }
}

function renderGenericObject(container: HTMLElement, obj: Record<string, JsonValue>, path: string[]): void {
  for (const [key, value] of Object.entries(obj)) {
    const fieldPath = [...path, key];
    const pathStr = fieldPath.join('.');

    if (isPlainObject(value)) {
      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = humanize(key);
      fieldset.appendChild(legend);
      container.appendChild(fieldset);
      renderGenericObject(fieldset, value, fieldPath);
      continue;
    }

    const row = document.createElement('div');
    row.className = 'field-row';
    const label = document.createElement('label');
    label.textContent = humanize(key);
    row.appendChild(label);

    if (UNION_FIELDS[pathStr]) {
      const select = document.createElement('select');
      for (const choice of UNION_FIELDS[pathStr]) {
        const opt = document.createElement('option');
        opt.value = choice;
        opt.textContent = choice;
        if (choice === value) opt.selected = true;
        select.appendChild(opt);
      }
      select.addEventListener('change', () => { setPath(fieldPath, select.value); markDirty(); });
      row.appendChild(select);
    } else if (typeof value === 'boolean') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = value;
      input.addEventListener('change', () => { setPath(fieldPath, input.checked); markDirty(); });
      row.appendChild(input);
    } else if (typeof value === 'number') {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = value === Infinity ? 'Infinity' : String(value);
      input.addEventListener('change', () => {
        const raw = input.value.trim();
        const n = raw.toLowerCase() === 'infinity' ? Infinity : Number(raw);
        if (!Number.isNaN(n)) { setPath(fieldPath, n); markDirty(); }
      });
      row.appendChild(input);
    } else if (Array.isArray(value)) {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = value.join(', ');
      input.addEventListener('change', () => {
        const arr = input.value.split(',').map(s => s.trim()).filter(Boolean);
        setPath(fieldPath, arr);
        markDirty();
      });
      row.appendChild(input);
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = String(value);
      input.addEventListener('change', () => { setPath(fieldPath, input.value); markDirty(); });
      row.appendChild(input);
    }
    container.appendChild(row);
  }
}

// ── App picker ───────────────────────────────────────────────────────────────

/** Lets the user pick from actually-installed apps (parsed from .desktop
 *  entries) instead of hand-typing a command and icon name — the same
 *  source every launcher/dock on the desktop reads from. */
async function openAppPicker(
  onPick: (name: string, command: string, args: string[], icon: string | null) => void,
): Promise<void> {
  if (!desktopAppsCache) desktopAppsCache = await window.configApi.listApps();
  const apps = desktopAppsCache;

  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay';
  const panel = document.createElement('div');
  panel.className = 'picker-panel';
  overlay.appendChild(panel);

  const search = document.createElement('input');
  search.type = 'text';
  search.placeholder = 'Search installed apps…';
  search.className = 'picker-search';
  panel.appendChild(search);

  const list = document.createElement('div');
  list.className = 'picker-list';
  panel.appendChild(list);

  function close(): void {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close();
  }

  function renderItems(query: string): void {
    list.innerHTML = '';
    const q = query.trim().toLowerCase();
    const filtered = q ? apps.filter(a => a.name.toLowerCase().includes(q)) : apps;
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'picker-empty';
      empty.textContent = 'No matching apps';
      list.appendChild(empty);
      return;
    }
    for (const a of filtered.slice(0, 300)) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'picker-item';
      item.textContent = a.name;
      item.addEventListener('click', () => { onPick(a.name, a.command, a.args, a.icon); close(); });
      list.appendChild(item);
    }
  }
  renderItems('');
  search.addEventListener('input', () => renderItems(search.value));

  const customBtn = document.createElement('button');
  customBtn.type = 'button';
  customBtn.className = 'secondary picker-custom';
  customBtn.textContent = 'Add a custom app instead';
  customBtn.addEventListener('click', () => { onPick('New App', '', [], null); close(); });
  panel.appendChild(customBtn);

  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
  search.focus();
}

// ── DOCK ─────────────────────────────────────────────────────────────────────

function renderDock(container: HTMLElement, dock: Record<string, JsonValue>): void {
  const previewWrap = document.createElement('div');
  previewWrap.className = 'tb-preview-wrap';
  const preview = document.createElement('div');
  preview.className = 'touchbar-preview';
  previewWrap.appendChild(preview);
  const caption = document.createElement('p');
  caption.className = 'tb-preview-caption';
  caption.textContent = 'Live preview — reflects the settings below as you change them';
  previewWrap.appendChild(caption);
  container.appendChild(previewWrap);
  dockPreviewEl = preview;
  void renderDockPreview(preview, dock);

  const scalarKeys = ['iconSize', 'slot', 'gap', 'lift', 'panel', 'indicator', 'shortcut'];
  const scalarPart: Record<string, JsonValue> = {};
  for (const k of scalarKeys) if (dock[k] !== undefined) scalarPart[k] = dock[k];
  renderGenericObject(container, scalarPart, ['DOCK']);

  const fieldset = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = 'Apps';
  fieldset.appendChild(legend);
  container.appendChild(fieldset);

  const list = document.createElement('div');
  fieldset.appendChild(list);

  const apps = (dock.apps as Record<string, JsonValue>[] | undefined) ?? [];

  function renderList(): void {
    list.innerHTML = '';
    apps.forEach((appItem, idx) => list.appendChild(renderAppCard(appItem, idx, apps, renderList)));
  }
  renderList();

  const addBtn = document.createElement('button');
  addBtn.textContent = '+ Add app';
  addBtn.className = 'secondary';
  addBtn.type = 'button';
  addBtn.addEventListener('click', () => {
    void openAppPicker((name, command, argsList, icon) => {
      const id = uniqueAppId(
        name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app',
        apps,
      );
      const newApp: Record<string, JsonValue> = {
        id, label: name, iconGlyph: iconChoices[0] ?? 'FaFolder', color: '#7dd3fc', command,
      };
      if (icon) newApp.iconName = icon;
      if (argsList.length > 0) newApp.args = argsList;
      apps.push(newApp);
      setPath(['DOCK', 'apps'], apps);
      markDirty();
      renderList();
    });
  });
  fieldset.appendChild(addBtn);
}

function renderAppCard(
  appItem: Record<string, JsonValue>,
  idx: number,
  apps: Record<string, JsonValue>[],
  onStructuralChange: () => void,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'app-card';

  const header = document.createElement('div');
  header.className = 'app-card-header';

  const iconSelect = document.createElement('select');
  for (const choice of iconChoices) {
    const opt = document.createElement('option');
    opt.value = choice;
    opt.textContent = choice;
    if (choice === appItem.iconGlyph) opt.selected = true;
    iconSelect.appendChild(opt);
  }
  iconSelect.addEventListener('change', () => {
    appItem.iconGlyph = iconSelect.value;
    setPath(['DOCK', 'apps'], apps);
    markDirty();
  });
  header.appendChild(iconSelect);

  const idInput = smallTextInput((appItem.id as string) ?? '', v => {
    appItem.id = v;
    setPath(['DOCK', 'apps'], apps);
    markDirty();
  });
  idInput.placeholder = 'id';
  header.appendChild(idInput);

  const removeBtn = document.createElement('button');
  removeBtn.textContent = 'Remove';
  removeBtn.className = 'danger';
  removeBtn.type = 'button';
  removeBtn.addEventListener('click', () => {
    apps.splice(idx, 1);
    setPath(['DOCK', 'apps'], apps);
    markDirty();
    onStructuralChange();
  });
  header.appendChild(removeBtn);
  card.appendChild(header);

  const textFields: [string, string][] = [
    ['label', 'Label'], ['iconName', 'Icon name (theme)'], ['color', 'Color'], ['command', 'Command'],
  ];
  for (const [key, labelText] of textFields) {
    const row = document.createElement('div');
    row.className = 'field-row';
    const label = document.createElement('label');
    label.textContent = labelText;
    row.appendChild(label);
    const input = smallTextInput((appItem[key] as string) ?? '', v => {
      appItem[key] = v;
      setPath(['DOCK', 'apps'], apps);
      markDirty();
    });
    row.appendChild(input);
    card.appendChild(row);
  }

  const listFields: [string, string][] = [
    ['args', 'Args (comma-separated)'], ['matchClass', 'Match classes (comma-separated)'],
  ];
  for (const [key, labelText] of listFields) {
    const row = document.createElement('div');
    row.className = 'field-row';
    const label = document.createElement('label');
    label.textContent = labelText;
    row.appendChild(label);
    const arr = (appItem[key] as string[] | undefined) ?? [];
    const input = smallTextInput(arr.join(', '), v => {
      const parsed = v.split(',').map(s => s.trim()).filter(Boolean);
      if (parsed.length) appItem[key] = parsed; else delete appItem[key];
      setPath(['DOCK', 'apps'], apps);
      markDirty();
    });
    row.appendChild(input);
    card.appendChild(row);
  }

  return card;
}

function smallTextInput(value: string, onChange: (v: string) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.addEventListener('change', () => onChange(input.value));
  return input;
}

// ── Keymaps ──────────────────────────────────────────────────────────────────

function renderKeymap(
  container: HTMLElement,
  section: SectionName,
  keymap: Record<string, JsonValue>,
  actions: string[],
): void {
  for (const action of actions) {
    if (keymap[action] === undefined) continue;
    const row = document.createElement('div');
    row.className = 'field-row';
    const label = document.createElement('label');
    label.textContent = humanize(action);
    row.appendChild(label);
    const codes = (keymap[action] as number[]).slice();
    row.appendChild(renderKeyCapture(codes, newCodes => {
      keymap[action] = newCodes;
      setPath([section, action], newCodes);
      markDirty();
    }));
    container.appendChild(row);
  }
}

function renderOverrides(
  container: HTMLElement,
  section: SectionName,
  overrides: Record<string, JsonValue>,
  actions: string[],
): void {
  const list = document.createElement('div');
  container.appendChild(list);

  function renderList(): void {
    list.innerHTML = '';
    for (const [windowClass, partial] of Object.entries(overrides)) {
      if (!isPlainObject(partial)) continue;
      list.appendChild(renderOverrideBlock(section, windowClass, partial, overrides, actions, renderList));
    }
  }
  renderList();

  const addRow = document.createElement('div');
  addRow.className = 'field-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'window class, e.g. firefox';
  addRow.appendChild(input);
  const addBtn = document.createElement('button');
  addBtn.textContent = '+ Add override';
  addBtn.className = 'secondary';
  addBtn.type = 'button';
  addBtn.addEventListener('click', () => {
    const windowClass = input.value.trim().toLowerCase();
    if (!windowClass || overrides[windowClass] !== undefined) return;
    overrides[windowClass] = {};
    setPath([section], overrides);
    markDirty();
    input.value = '';
    renderList();
  });
  addRow.appendChild(addBtn);
  container.appendChild(addRow);
}

function renderOverrideBlock(
  section: SectionName,
  windowClass: string,
  partial: Record<string, JsonValue>,
  overrides: Record<string, JsonValue>,
  actions: string[],
  onStructuralChange: () => void,
): HTMLElement {
  const block = document.createElement('div');
  block.className = 'override-block';

  const header = document.createElement('div');
  header.className = 'override-block-header';
  const title = document.createElement('strong');
  title.textContent = windowClass;
  header.appendChild(title);
  const removeBtn = document.createElement('button');
  removeBtn.textContent = 'Remove';
  removeBtn.className = 'danger';
  removeBtn.type = 'button';
  removeBtn.addEventListener('click', () => {
    delete overrides[windowClass];
    setPath([section], overrides);
    markDirty();
    onStructuralChange();
  });
  header.appendChild(removeBtn);
  block.appendChild(header);

  for (const action of actions) {
    const row = document.createElement('div');
    row.className = 'field-row';
    const label = document.createElement('label');
    label.textContent = humanize(action);
    row.appendChild(label);
    const codes = ((partial[action] as number[] | undefined) ?? []).slice();
    row.appendChild(renderKeyCapture(codes, newCodes => {
      if (newCodes.length) partial[action] = newCodes; else delete partial[action];
      setPath([section], overrides);
      markDirty();
    }));
    block.appendChild(row);
  }

  return block;
}

// ── FN_KEYS ──────────────────────────────────────────────────────────────────

function renderFnKeys(container: HTMLElement, fnKeys: Record<string, JsonValue>): void {
  const list = document.createElement('div');
  container.appendChild(list);

  function extraArray(): Record<string, JsonValue>[] {
    return (fnKeys.extra as Record<string, JsonValue>[] | undefined) ?? [];
  }

  function renderList(): void {
    list.innerHTML = '';
    extraArray().forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'field-row';

      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.value = (entry.label as string | undefined) ?? '';
      labelInput.placeholder = 'label, e.g. prt sc';
      labelInput.addEventListener('change', () => {
        entry.label = labelInput.value;
        setPath(['FN_KEYS', 'extra'], extraArray());
        markDirty();
      });
      row.appendChild(labelInput);

      const codes = [entry.key as number];
      row.appendChild(renderKeyCapture(codes, newCodes => {
        if (!newCodes.length) return;
        entry.key = newCodes[newCodes.length - 1];
        setPath(['FN_KEYS', 'extra'], extraArray());
        markDirty();
      }));

      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Remove';
      removeBtn.className = 'danger';
      removeBtn.type = 'button';
      removeBtn.addEventListener('click', () => {
        extraArray().splice(i, 1);
        setPath(['FN_KEYS', 'extra'], extraArray());
        markDirty();
        renderList();
      });
      row.appendChild(removeBtn);

      list.appendChild(row);
    });
  }
  renderList();

  const addBtn = document.createElement('button');
  addBtn.textContent = '+ Add key';
  addBtn.className = 'secondary';
  addBtn.type = 'button';
  addBtn.addEventListener('click', () => {
    extraArray().push({ label: 'key', key: keyNames.ESC ?? 1 });
    setPath(['FN_KEYS', 'extra'], extraArray());
    markDirty();
    renderList();
  });
  container.appendChild(addBtn);
}

function renderKeyCapture(codes: number[], onChange: (codes: number[]) => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'key-capture';
  el.tabIndex = 0;

  const render = (): void => {
    el.textContent = codes.length ? codes.map(keyNameFor).join(' + ') : '(click to set)';
  };
  render();

  let listening = false;
  let captured: number[] = [];

  el.addEventListener('click', () => {
    listening = true;
    captured = [];
    el.classList.add('listening');
    el.textContent = 'Press keys… (Enter to confirm, Esc to cancel)';
    el.focus();
  });

  el.addEventListener('blur', () => {
    listening = false;
    el.classList.remove('listening');
    render();
  });

  el.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!listening) return;
    e.preventDefault();
    if (e.key === 'Escape') { listening = false; el.classList.remove('listening'); render(); return; }
    if (e.key === 'Enter') {
      listening = false;
      el.classList.remove('listening');
      if (captured.length) { codes.length = 0; codes.push(...captured); onChange(codes); }
      render();
      return;
    }
    const name = domCodeToKeyName[e.code];
    const code = name ? keyNames[name] : undefined;
    if (code !== undefined && !captured.includes(code)) {
      captured.push(code);
      el.textContent = captured.map(keyNameFor).join(' + ') + ' …';
    }
  });

  return el;
}

// ── Topbar ───────────────────────────────────────────────────────────────────

function wireTopbar(): void {
  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
  const restartBtn = document.getElementById('restart-btn') as HTMLButtonElement;
  const status = document.getElementById('status')!;

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const res = await window.configApi.write(state);
    saveBtn.disabled = false;
    if (res.ok) {
      dirty = false;
      status.textContent = 'Saved';
      status.className = 'ok';
      restartBtn.style.display = '';
    } else {
      status.textContent = `Save failed: ${res.error}`;
      status.className = 'error';
    }
  });

  restartBtn.addEventListener('click', async () => {
    restartBtn.disabled = true;
    const res = await window.configApi.restart();
    restartBtn.disabled = false;
    status.textContent = res.ok ? res.message : `Restart failed: ${res.message}`;
    status.className = res.ok ? 'ok' : 'error';
    if (res.ok) restartBtn.style.display = 'none';
  });

  document.getElementById('win-minimize')!.addEventListener('click', () => window.windowApi.minimize());
  document.getElementById('win-maximize')!.addEventListener('click', () => window.windowApi.toggleMaximize());
  document.getElementById('win-close')!.addEventListener('click', () => window.windowApi.close());
}

wireWindowControls();
main();
