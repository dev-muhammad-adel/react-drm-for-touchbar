import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { useState, useEffect, useRef, useCallback } from 'react';
import { keys } from '../services/keyInjector';
import { KEY } from 'react-drm';
import dbus, { MessageBus, ClientInterface } from 'dbus-next';
import { Fzf, byLengthAsc } from 'fzf';
import { useActiveWindow } from './useActiveWindow';
import { KONSOLE } from '../config';

// ── History ──────────────────────────────────────────────────────────────────

function readProcEnv(pid: number): Record<string, string> {
  try {
    return Object.fromEntries(
      fs.readFileSync(`/proc/${pid}/environ`, 'utf8')
        .split('\0').filter(Boolean)
        .map(e => { const i = e.indexOf('='); return [e.slice(0, i), e.slice(i + 1)]; })
    );
  } catch { return {}; }
}

function defaultHistFile(shell: string, home: string): string {
  switch (shell) {
    case 'fish': return `${home}/.local/share/fish/fish_history`;
    case 'zsh':  return `${home}/.zsh_history`;
    default:     return `${home}/.bash_history`;
  }
}

interface RawEntry { cmd: string; paths: string[] }

/** Per-command aggregate used for context-aware ranking. */
export interface CmdMeta {
  count:   number;       // how often it was run
  lastIdx: number;       // position of the most recent run (higher = more recent)
  paths:   Set<string>;  // file/dir arguments fish recorded for it
}

/** History in file order (oldest → newest) — order is needed for next-command prediction. */
function parseHistory(shell: string, content: string): RawEntry[] {
  if (shell === 'fish') {
    const entries: RawEntry[] = [];
    for (const line of content.split('\n')) {
      const c = line.match(/^- cmd: (.+)$/);
      if (c) { entries.push({ cmd: c[1].trim(), paths: [] }); continue; }
      const p = line.match(/^\s+- (.+)$/); // items under "  paths:"
      if (p && entries.length) entries[entries.length - 1].paths.push(p[1].trim());
    }
    return entries;
  }
  if (shell === 'zsh') {
    return content.split('\n')
      .map(l => l.replace(/^: \d+:\d+;/, '').trim())
      .filter(l => l && !l.startsWith('#'))
      .map(cmd => ({ cmd, paths: [] }));
  }
  return content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(cmd => ({ cmd, paths: [] }));
}

/** Newest-first, duplicates removed — the candidate list for fuzzy matching. */
function dedupeNewestFirst(ordered: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (!seen.has(ordered[i])) { seen.add(ordered[i]); result.push(ordered[i]); }
  }
  return result;
}

function loadHistory(shell: string, pid: number): {
  file: string; cmds: string[]; ordered: string[]; meta: Map<string, CmdMeta>;
} {
  const env  = readProcEnv(pid);
  const home = env.HOME ?? process.env.HOME ?? '';
  const file = env.HISTFILE || defaultHistFile(shell, home);
  try {
    const entries = parseHistory(shell, fs.readFileSync(file, 'utf8'));
    const ordered = entries.map(e => e.cmd);
    const meta = new Map<string, CmdMeta>();
    entries.forEach((e, i) => {
      const m = meta.get(e.cmd) ?? { count: 0, lastIdx: 0, paths: new Set<string>() };
      m.count += 1;
      m.lastIdx = i;
      e.paths.forEach(p => m.paths.add(p));
      meta.set(e.cmd, m);
    });
    return { file, cmds: dedupeNewestFirst(ordered), ordered, meta };
  } catch { return { file, cmds: [], ordered: [], meta: new Map() }; }
}

// ── Context-aware ranking ─────────────────────────────────────────────────────
// fzf's text score is the base (~16–24 per matched char); context boosts are sized
// to tip ties and near-ties, not to override a clearly better text match.

const RANK = { cwdPath: 20, tool: 10, recencyMax: 12, freqMax: 10 };

const PROJECT_TOOLS: [marker: string, tools: string[]][] = [
  ['package.json',       ['npm', 'npx', 'node', 'pnpm', 'yarn', 'bun', 'tsx']],
  ['Cargo.toml',         ['cargo']],
  ['go.mod',             ['go']],
  ['Makefile',           ['make']],
  ['.git',               ['git', 'gh']],
  ['docker-compose.yml', ['docker']],
  ['compose.yaml',       ['docker']],
];

function projectTools(cwd: string): Set<string> {
  const tools = new Set<string>();
  for (const [marker, t] of PROJECT_TOOLS) {
    try { if (fs.existsSync(path.join(cwd, marker))) t.forEach(x => tools.add(x)); } catch {}
  }
  return tools;
}

/** Did this command touch anything in/under the current directory? */
function pathsRelevant(paths: Set<string>, cwd: string, home: string): boolean {
  for (const p of paths) {
    if (p.startsWith('/') || p.startsWith('~')) {
      const abs = p.startsWith('~') ? home + p.slice(1) : p;
      if (abs.startsWith(cwd)) return true;
    } else {
      try { if (fs.existsSync(path.join(cwd, p))) return true; } catch {}
    }
  }
  return false;
}

/** Fish paints its gray inline autosuggestion into the terminal text, so the screen
 *  shows the FULL suggested command even when only a few chars were typed. If the
 *  extracted line equals a history entry, recover the shortest prefix whose most
 *  recent history match is that entry — that's (approximately) what was typed. */
function autosuggestPrefix(ordered: string[], full: string): string {
  for (let len = 2; len < full.length; len++) {
    const p = full.slice(0, len);
    for (let i = ordered.length - 1; i >= 0; i--) {
      if (ordered[i].startsWith(p)) {
        if (ordered[i] === full) return p;
        break; // a more recent entry matches this prefix — fish would suggest that one
      }
    }
  }
  return full;
}

/** Commands that historically followed `lastCmd`, ranked by frequency (recent runs win ties). */
function predictNext(ordered: string[], lastCmd: string, limit: number): string[] {
  const counts = new Map<string, number>();
  for (let i = 0; i < ordered.length - 1; i++) {
    if (ordered[i] === lastCmd) {
      const follower = ordered[i + 1];
      // Later occurrences add slightly more, so recent habits outrank old ones on ties.
      counts.set(follower, (counts.get(follower) ?? 0) + 1 + i / ordered.length);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([cmd]) => cmd);
}

// ── Screen input extraction ───────────────────────────────────────────────────

function cleanLine(l: string): string {
  return l
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\p{Co}/gu, '')
    .replace(/\r/g, '');
}

/** Collapse trailing whitespace to a single space (kept so "git checkout " completes the NEXT token). */
function normalizeInput(s: string): string {
  const t = s.trimStart();
  return /\s$/.test(t) ? t.trimEnd() + ' ' : t;
}

function extractCurrentInput(screen: string): string {
  const lines = screen.split('\n').map(cleanLine);

  // Two-line fish prompts: the last line containing '→' is the prompt/info line
  // (path, git status etc. may follow the arrow); everything BELOW it is the input
  // being typed, wrapped lines included. After a command runs a fresh prompt line
  // is printed with nothing below it, so this correctly yields ''.
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes('→')) {
      return normalizeInput(lines.slice(i + 1).join(''));
    }
  }

  // Single-line prompts (bash, zsh): input follows the prompt char on the LAST line
  // only — scanning higher lines would pick up previously executed commands.
  const m = (lines[lines.length - 1] ?? '').match(/(?:❯|➡|\$|%|#|>)\s+(.+)$/);
  return m ? normalizeInput(m[1]) : '';
}

// ── Fish completion engine ────────────────────────────────────────────────────
// `complete -C` runs fish's full completion machinery non-interactively:
// subcommands, flags (with descriptions), file paths, git branches, etc.
// cwd must be the konsole shell's cwd so file completions resolve correctly.

function fishComplete(input: string, cwd?: string): Promise<string[]> {
  return new Promise(resolve => {
    execFile('fish', ['-c', 'complete -C $argv[1]', input],
      { timeout: 2000, ...(cwd ? { cwd } : {}) },
      (err, stdout) => {
        if (err) return resolve([]);
        resolve(stdout.split('\n').filter(Boolean).map(l => l.split('\t')[0]));
      });
  });
}

/** "git ch" → ["git ", "ch"]; "git checkout " → ["git checkout ", ""] */
function splitLastToken(input: string): [string, string] {
  const lastTok = input.match(/(\S*)$/)![1];
  return [input.slice(0, input.length - lastTok.length), lastTok];
}

/** Trailing pad after a fill-in completion so the next poll completes the NEXT token. */
function tokenPad(cmd: string): string {
  return cmd.endsWith('/') || cmd.endsWith('=') ? '' : ' ';
}

// ── D-Bus helpers ─────────────────────────────────────────────────────────────
// Konsole may run single-process (all windows under one service, often the
// plain 'org.kde.konsole' name) or one process per window ('org.kde.konsole-
// <pid>'). Every service is tracked; the focused window's process is found by
// matching the compositor's active-window pid, and the focused GUI window via
// the QWidget isActiveWindow property on /konsole/MainWindow_<n>.
//
// The catch: session control lives on /Windows/<m>, whose numbering is
// UNRELATED to MainWindow_<n> (MainWindow numbers are reused after closes,
// Windows ids only grow — MainWindow_3 ↔ /Windows/8 was observed), and
// konsole offers no D-Bus bridge between the two trees. The pairing is
// learned instead (see resolveTarget) and tab actions go through the focused
// MainWindow's action collection, which needs no pairing at all.

const isKonsoleService = (n: string) => n.startsWith('org.kde.konsole');

async function servicePid(bus: MessageBus, svc: string): Promise<number> {
  const reply = await bus.call(new dbus.Message({
    destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus',
    interface: 'org.freedesktop.DBus', member: 'GetConnectionUnixProcessID',
    signature: 's', body: [svc],
  }));
  return Number(reply?.body[0] ?? 0);
}

async function widgetProp(bus: MessageBus, svc: string, n: string, prop: string): Promise<unknown> {
  const reply = await bus.call(new dbus.Message({
    destination: svc, path: `/konsole/MainWindow_${n}`,
    interface: 'org.freedesktop.DBus.Properties', member: 'Get',
    signature: 'ss', body: ['org.qtproject.Qt.QWidget', prop],
  }));
  return (reply?.body[0] as dbus.Variant)?.value;
}

/** Per-window tab state used for pairing inference. */
interface WinInfo { cur: number; list: string; title: string }

async function windowInfo(bus: MessageBus, svc: string, winPath: string): Promise<WinInfo> {
  const win  = (await bus.getProxyObject(svc, winPath)).getInterface('org.kde.konsole.Window');
  const id   = Number(await win.currentSession());
  const list = ((await win.sessionList()) as (string | number)[]).map(Number).join(',');
  const sess = (await bus.getProxyObject(svc, `/Sessions/${id}`)).getInterface('org.kde.konsole.Session');
  const title = String(await sess.title(1));
  return { cur: id, list, title };
}


function parseTabViews(hierarchy: string[]): number[][] {
  return hierarchy.map(entry => {
    const body = entry.replace(/^\(\d+\)/, '').replace(/\(\d+\)\{/g, '{');
    return (body.match(/\d+/g) ?? []).map(Number);
  });
}

function shortenPath(p: string): string {
  const parts = p.replace(/^~\//, '').split('/').filter(Boolean);
  const prefix = p.startsWith('~') ? '~/' : '/';
  if (parts.length <= 2) return p;
  return prefix + parts.slice(-2).join('/');
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KonsoleSession { id: number; title: string; }

export interface SessionStatus {
  cwd:           string;
  isRunning:     boolean;
  foregroundCmd: string;
}

export interface Suggestion {
  cmd: string;
  /** true = full command from history (tap runs it); false = fish completion (tap fills the line). */
  execute: boolean;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useKonsole() {
  const [connected,   setConnected]   = useState(false);
  const [sessions,    setSessions]    = useState<KonsoleSession[]>([]);
  const [activeId,    setActiveId]    = useState<number | null>(null);
  const [status,      setStatus]      = useState<SessionStatus>({ cwd: '', isRunning: false, foregroundCmd: '' });
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [tabCount,    setTabCount]    = useState(0);
  const [activeTabIdx, setActiveTabIdx] = useState(0);

  const { pid: activePid } = useActiveWindow();

  const busRef         = useRef<MessageBus | null>(null);
  const svcsRef        = useRef<Map<string, number>>(new Map()); // service name → unix pid
  const winPathRef     = useRef<string | null>(null);
  const activePidRef   = useRef(0);
  const pairsRef       = useRef<Map<string, string>>(new Map()); // `${svc}|${mwNum}` → /Windows/<m>
  const prevScanRef    = useRef<Map<string, { mws: string[]; wins: string[] }>>(new Map());
  const prevInfoRef    = useRef<Map<string, WinInfo>>(new Map()); // `${svc}${win}` → last tab state
  const focusedMwRef   = useRef<{ svc: string; num: string } | null>(null);
  const serviceRef     = useRef<string | null>(null);
  const windowRef      = useRef<ClientInterface | null>(null);
  const activeIdRef    = useRef<number | null>(null);
  const activeSessRef  = useRef<ClientInterface | null>(null);
  const shellPidRef    = useRef<number | null>(null);
  const sessCache      = useRef<Map<number, ClientInterface>>(new Map());
  const titleMap       = useRef<Map<number, string>>(new Map());
  const viewSessRef    = useRef<Map<number, number>>(new Map()); // view id → session id (learned)
  const activeTabRef   = useRef(0);
  const fzfRef         = useRef<Fzf<string[]> | null>(null);
  const histSetRef     = useRef<Set<string>>(new Set());
  const orderedRef     = useRef<string[]>([]);
  const metaRef        = useRef<Map<string, CmdMeta>>(new Map());
  const toolsCacheRef  = useRef<{ cwd: string; tools: Set<string> } | null>(null);
  const histWatcherRef = useRef<fs.FSWatcher | null>(null);
  const lastInputRef   = useRef('');
  const predKeyRef     = useRef<string | null>(null);

  activeIdRef.current  = activeId;
  activePidRef.current = activePid;

  const flushSessions = useCallback(() => {
    setSessions(Array.from(titleMap.current.entries()).map(([id, title]) => ({ id, title })));
  }, []);

  const getSessionIface = useCallback(async (svc: string, id: number): Promise<ClientInterface> => {
    const cached = sessCache.current.get(id);
    if (cached) return cached;
    const obj   = await busRef.current!.getProxyObject(svc, `/Sessions/${id}`);
    const iface = obj.getInterface('org.kde.konsole.Session');
    sessCache.current.set(id, iface);
    return iface;
  }, []);

  // Cap the candidate set so fzf scoring stays cheap on the 300ms poll tick.
  // limit 50 = ranking pool; context scoring reorders it before slicing to 15.
  const buildMatcher = useCallback((cmds: string[]) => {
    fzfRef.current = new Fzf(cmds.slice(0, 5000), {
      casing: 'smart-case',
      limit: 50,
      tiebreakers: [byLengthAsc],
    });
    histSetRef.current = new Set(cmds);
  }, []);

  // fzf text score + context: ran in/on this directory, fits the project's tooling,
  // recent, frequent. Pool of 50 fzf matches re-ranked, best 15 kept.
  const rankHistory = useCallback((input: string, cwd: string): string[] => {
    const results = fzfRef.current?.find(input) ?? [];
    const meta    = metaRef.current;
    const total   = orderedRef.current.length || 1;
    const home    = process.env.HOME ?? '';
    if (cwd && toolsCacheRef.current?.cwd !== cwd) {
      toolsCacheRef.current = { cwd, tools: projectTools(cwd) };
    }
    const tools = toolsCacheRef.current?.tools ?? new Set<string>();

    return results
      .map(r => {
        let score = r.score;
        const m = meta.get(r.item);
        if (m) {
          score += Math.min(RANK.freqMax, Math.log2(m.count + 1) * 3);
          score += (m.lastIdx / total) * RANK.recencyMax;
          if (cwd && m.paths.size && pathsRelevant(m.paths, cwd, home)) score += RANK.cwdPath;
        }
        if (tools.has(r.item.split(' ', 1)[0])) score += RANK.tool;
        return { cmd: r.item, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)
      .map(s => s.cmd);
  }, []);

  const reloadHistory = useCallback((shell: string, shellPid: number) => {
    histWatcherRef.current?.close();
    const { file, cmds, ordered, meta } = loadHistory(shell, shellPid);
    buildMatcher(cmds);
    orderedRef.current = ordered;
    metaRef.current    = meta;
    predKeyRef.current = null; // newest history entry changed — recompute predictions
    try {
      histWatcherRef.current = fs.watch(file, () => {
        const fresh = loadHistory(shell, shellPid);
        buildMatcher(fresh.cmds);
        orderedRef.current = fresh.ordered;
        metaRef.current    = fresh.meta;
        predKeyRef.current = null;
      });
    } catch {}
  }, [buildMatcher]);

  const switchActiveSess = useCallback(async (svc: string, id: number) => {
    try {
      const sess    = await getSessionIface(svc, id);
      activeSessRef.current = sess;
      const shellPid: number = await sess.processId();
      shellPidRef.current = shellPid;
      const shell = fs.readFileSync(`/proc/${shellPid}/comm`, 'utf8').trim();
      reloadHistory(shell, shellPid);
    } catch {}
  }, [getSessionIface, reloadHistory]);

  /**
   * Find the focused konsole window across all services. The MainWindow↔
   * Windows pairing cannot be queried, so it is learned and cached from:
   * single-window processes (trivial), a MainWindow and a Windows object
   * appearing in the same scan (window created while we watch), the focused
   * window's tab changing (only the focused window switches tabs), and a
   * title that matches exactly one window. Fallback: current attachment.
   */
  const resolveTarget = useCallback(async (): Promise<{ svc: string; win: string } | null> => {
    const bus  = busRef.current!;
    const svcs = svcsRef.current;
    if (svcs.size === 0) return null;

    const keys  = [...svcs.keys()];
    const byPid = keys.find(s => svcs.get(s) === activePidRef.current);
    const first = byPid ?? (serviceRef.current && svcs.has(serviceRef.current) ? serviceRef.current : keys[0]);
    const ordered = [first, ...keys.filter(s => s !== first)];

    for (const svc of ordered) {
      try {
        const wins = (await bus.getProxyObject(svc, '/Windows')).nodes
          .filter(n => /\/Windows\/\d+$/.test(n));
        const mws = (await bus.getProxyObject(svc, '/konsole')).nodes
          .map(n => n.match(/\/MainWindow_(\d+)$/)?.[1])
          .filter((x): x is string => x !== undefined);

        // Drop pairs whose window vanished; learn from creation diffs.
        for (const [k, w] of pairsRef.current) {
          if (!k.startsWith(`${svc}|`)) continue;
          if (!mws.includes(k.slice(svc.length + 1)) || !wins.includes(w)) pairsRef.current.delete(k);
        }
        const prev = prevScanRef.current.get(svc);
        if (prev) {
          const newMws  = mws.filter(n => !prev.mws.includes(n));
          const newWins = wins.filter(w => !prev.wins.includes(w));
          if (newMws.length === 1 && newWins.length === 1) pairsRef.current.set(`${svc}|${newMws[0]}`, newWins[0]);
        }
        prevScanRef.current.set(svc, { mws, wins });
        if (wins.length === 1 && mws.length === 1) pairsRef.current.set(`${svc}|${mws[0]}`, wins[0]);

        if (wins.length === 0) continue;

        let focused: string | null = null;
        for (const n of mws) {
          if (await widgetProp(bus, svc, n, 'isActiveWindow').catch(() => false)) { focused = n; break; }
        }
        if (focused) focusedMwRef.current = { svc, num: focused };
        else if (focusedMwRef.current && (focusedMwRef.current.svc !== svc || !mws.includes(focusedMwRef.current.num))) {
          focusedMwRef.current = null;
        }

        if (wins.length === 1) return { svc, win: wins[0] };

        if (focused) {
          const cached = pairsRef.current.get(`${svc}|${focused}`);
          if (cached) return { svc, win: cached };

          // Pairing unknown — gather per-window tab state to infer it.
          const infos = new Map<string, WinInfo>();
          for (const w of wins) {
            const info = await windowInfo(bus, svc, w).catch(() => null);
            if (info) infos.set(w, info);
          }

          // A tab switch (current changed, tab set unchanged) can only come
          // from the focused window.
          let switched: string | null = null;
          let ambiguous = false;
          for (const [w, info] of infos) {
            const old = prevInfoRef.current.get(`${svc}${w}`);
            prevInfoRef.current.set(`${svc}${w}`, info);
            if (old && old.cur !== info.cur && old.list === info.list) {
              if (switched) ambiguous = true;
              switched = w;
            }
          }
          if (switched && !ambiguous) {
            pairsRef.current.set(`${svc}|${focused}`, switched);
            return { svc, win: switched };
          }

          // Title match — trust it only when it is unique among windows.
          const ft = String(await widgetProp(bus, svc, focused, 'windowTitle').catch(() => '') ?? '');
          const matches = [...infos.entries()].filter(([, i]) => i.title === ft).map(([w]) => w);
          if (ft && matches.length === 1) {
            pairsRef.current.set(`${svc}|${focused}`, matches[0]);
            return { svc, win: matches[0] };
          }
        }

        // Unknown or unfocused — stick with the attached window if it still
        // exists so the panel doesn't churn, else take the first.
        const cur = winPathRef.current;
        return { svc, win: svc === serviceRef.current && cur && wins.includes(cur) ? cur : wins[0] };
      } catch { continue; } // service died mid-scan
    }
    return null;
  }, []);

  const attachService = useCallback(async (svc: string, winPath: string, bus: MessageBus) => {
    try {
      const obj = await bus.getProxyObject(svc, winPath);
      const win = obj.getInterface('org.kde.konsole.Window');

      windowRef.current  = win;
      serviceRef.current = svc;
      winPathRef.current = winPath;
      sessCache.current.clear();
      titleMap.current.clear();
      viewSessRef.current.clear();
      activeTabRef.current = 0;
      setActiveTabIdx(0);

      // No live setup beyond this: konsole's Window/Session D-Bus interfaces expose
      // no signals (sessionAdded/currentSessionChanged/titleChanged don't exist),
      // so the 300ms poll below keeps sessions, titles, and the active tab in sync.
      const curId: number = Number(await win.currentSession());
      setActiveId(curId);
      activeIdRef.current = curId;
      setConnected(true);
      await switchActiveSess(svc, curId);
    } catch {
      // A failed attach (e.g. racing konsole's startup) must not leave the
      // refs looking attached, or the poll would never retry this target.
      windowRef.current  = null;
      serviceRef.current = null;
      winPathRef.current = null;
    }
  }, [flushSessions, getSessionIface, switchActiveSess]);

  useEffect(() => {
    let alive = true;
    const bus = dbus.sessionBus();
    busRef.current = bus;

    async function init() {
      const dbusObj   = await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus');
      const dbusIface = dbusObj.getInterface('org.freedesktop.DBus');

      dbusIface.on('NameOwnerChanged', async (name: string, _old: string, newOwner: string) => {
        if (!alive || !isKonsoleService(name)) return;
        if (newOwner) {
          svcsRef.current.set(name, await servicePid(bus, name).catch(() => 0));
        } else {
          svcsRef.current.delete(name);
          prevScanRef.current.delete(name);
          for (const k of [...pairsRef.current.keys()]) if (k.startsWith(`${name}|`)) pairsRef.current.delete(k);
          for (const k of [...prevInfoRef.current.keys()]) if (k.startsWith(name)) prevInfoRef.current.delete(k);
          if (focusedMwRef.current?.svc === name) focusedMwRef.current = null;
          if (serviceRef.current === name) {
            windowRef.current     = null;
            serviceRef.current    = null;
            winPathRef.current    = null;
            activeSessRef.current = null;
            shellPidRef.current   = null;
            sessCache.current.clear();
            titleMap.current.clear();
            viewSessRef.current.clear();
            activeTabRef.current = 0;
            histWatcherRef.current?.close();
            setSessions([]);
            setActiveId(null);
            setConnected(false);
            setSuggestions([]);
            setTabCount(0);
            setActiveTabIdx(0);
            setStatus({ cwd: '', isRunning: false, foregroundCmd: '' });
          }
        }
      });

      const names: string[] = await dbusIface.ListNames();
      for (const n of names.filter(isKonsoleService)) {
        svcsRef.current.set(n, await servicePid(bus, n).catch(() => 0));
      }
      const target = await resolveTarget();
      if (alive && target) await attachService(target.svc, target.win, bus);
    }

    init().catch(() => {});

    const timer = setInterval(async () => {
      if (!alive) return;
      try {
        // ── Retarget to the focused window — services and windows come and go ──
        const target = await resolveTarget();
        if (!alive) return;
        if (target && (target.svc !== serviceRef.current || target.win !== winPathRef.current)) {
          await attachService(target.svc, target.win, busRef.current!);
        }

        // ── Tab/session sync — konsole exposes no D-Bus signals, so poll ──
        const win = windowRef.current;
        const svc = serviceRef.current;
        if (!win || !svc) return;
        const [rawIds, curRaw, rawHier] = await Promise.all([
          win.sessionList(), win.currentSession(), win.viewHierarchy(),
        ]);
        if (!alive) return;
        const ids   = (rawIds as (string | number)[]).map(Number);
        const curId = Number(curRaw);

        // ── Tab/split accounting ──────────────────────────────────────────────
        // A konsole tab can hold several split views, each its own session, so
        // sessionList() over-counts tabs. viewHierarchy() lists one entry per
        // tab; its length is the real tab count. To know which tab is active we
        // need the current session's view, but the hierarchy exposes only view
        // ids while currentSession() is a session id — and konsole offers no
        // bridge. The mapping is learned by diff (like resolveTarget's pairing):
        // view ids are monotonic and unique, so a newly appeared view pairs with
        // a newly appeared session. Session ids ARE reused, so stale pairs are
        // pruned when their session leaves the list or their view disappears.
        const tabs      = parseTabViews((rawHier as string[]) ?? []);
        const flatViews = tabs.flat();
        const vs        = viewSessRef.current;
        for (const v of [...vs.keys()]) if (!flatViews.includes(v)) vs.delete(v);
        for (const [v, s] of [...vs]) if (!ids.includes(s)) vs.delete(v);
        const newViews = flatViews.filter(v => !vs.has(v)).sort((a, b) => a - b);
        const mapped   = new Set(vs.values());
        const newSess  = ids.filter(s => !mapped.has(s)).sort((a, b) => a - b);
        // Pair in creation order: both view ids (monotonic) and the freshly
        // created sessions sort ascending into the order they were opened.
        newViews.forEach((v, i) => { if (i < newSess.length) vs.set(v, newSess[i]); });

        if (tabs.length !== tabCount) setTabCount(tabs.length);
        const at = tabs.findIndex(views => views.some(v => vs.get(v) === curId));
        if (at !== -1 && at !== activeTabRef.current) {
          activeTabRef.current = at;
          setActiveTabIdx(at);
        }

        let changed = false;
        for (const id of ids) {
          const s = await getSessionIface(svc, id);
          const title: string = (await s.title(1).catch(() => '')) || `Session ${id}`;
          if (titleMap.current.get(id) !== title) { titleMap.current.set(id, title); changed = true; }
        }
        for (const id of [...titleMap.current.keys()]) {
          if (!ids.includes(id)) { titleMap.current.delete(id); sessCache.current.delete(id); changed = true; }
        }
        if (changed) flushSessions();

        if (curId !== activeIdRef.current) {
          activeIdRef.current = curId;
          setActiveId(curId);
          lastInputRef.current = '';
          predKeyRef.current   = null;
          setSuggestions([]);
          await switchActiveSess(svc, curId);
        }

        const sess     = activeSessRef.current;
        const shellPid = shellPidRef.current;
        if (!sess || shellPid === null) return;

        const [fgPid, screen]: [number, string] = await Promise.all([
          sess.foregroundProcessId(),
          sess.getAllDisplayedText(),
        ]);

        let cwd = '';
        let rawCwd = '';
        try {
          rawCwd = fs.readlinkSync(`/proc/${shellPid}/cwd`);
          const home = process.env.HOME ?? '';
          cwd = shortenPath(home && rawCwd.startsWith(home) ? '~' + rawCwd.slice(home.length) : rawCwd);
        } catch {}

        const isRunning = fgPid > 0 && fgPid !== shellPid;
        let foregroundCmd = '';
        if (isRunning) {
          try { foregroundCmd = fs.readFileSync(`/proc/${fgPid}/comm`, 'utf8').trim(); } catch {}
        }
        setStatus({ cwd, isRunning, foregroundCmd });

        if (!isRunning) {
          const input = extractCurrentInput(screen);
          if (input.length >= 2) {
            // Recompute only when the typed input changed — fishComplete costs ~400ms.
            if (input !== lastInputRef.current) {
              lastInputRef.current = input;
              predKeyRef.current = null; // leaving prediction mode — re-render on return to empty

              // Screen text includes fish's gray inline autosuggestion; match
              // against what was likely typed, not the auto-completed full line.
              const effInput = histSetRef.current.has(input)
                ? autosuggestPrefix(orderedRef.current, input)
                : input;
              const [prefix] = splitLastToken(effInput);
              const hist = rankHistory(effInput, rawCwd);

              const buildList = (comps: string[]): Suggestion[] => {
                const seen = new Set([input]);
                const merged: Suggestion[] = [];
                const push = (s: Suggestion) => {
                  if (!seen.has(s.cmd)) { seen.add(s.cmd); merged.push(s); }
                };
                // History first (full commands), but leave room for completions; backfill after.
                hist.slice(0, 7).forEach(cmd => push({ cmd, execute: true }));
                comps.forEach(c => push({ cmd: prefix + c, execute: false }));
                hist.slice(7).forEach(cmd => push({ cmd, execute: true }));
                return merged.slice(0, 15);
              };

              // Paint history matches immediately; append fish completions when ready.
              setSuggestions(buildList([]));
              const comps = await fishComplete(effInput, rawCwd || undefined);
              if (lastInputRef.current !== input) return; // input moved on — drop stale results
              setSuggestions(buildList(comps));
            }
          } else if (input === '') {
            // Empty prompt — predict the next command from what historically
            // followed the one that just ran (context from execution order).
            lastInputRef.current = '';
            const ordered = orderedRef.current;
            const lastCmd = ordered[ordered.length - 1];
            if (lastCmd && predKeyRef.current !== lastCmd) {
              predKeyRef.current = lastCmd;
              const preds = predictNext(ordered, lastCmd, 8);
              setSuggestions(preds.map(cmd => ({ cmd, execute: true })));
            } else if (!lastCmd) {
              setSuggestions([]);
            }
          } else {
            // 1 char typed — too short to match, drop any prediction chips
            lastInputRef.current = '';
            predKeyRef.current = null;
            setSuggestions([]);
          }
        } else {
          lastInputRef.current = '';
          predKeyRef.current = null;
          setSuggestions([]);
        }
      } catch {}
    }, KONSOLE.pollMs);

    return () => {
      alive = false;
      clearInterval(timer);
      histWatcherRef.current?.close();
      bus.disconnect();
    };
  }, [attachService, resolveTarget]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  // Tab actions go through the focused MainWindow's action collection —
  // correct regardless of the MainWindow↔Windows pairing. Falls back to the
  // attached control object when no konsole window has focus.
  const activateWindowAction = useCallback(async (name: string): Promise<boolean> => {
    const f   = focusedMwRef.current;
    const bus = busRef.current;
    if (!f || !bus) return false;
    try {
      await bus.call(new dbus.Message({
        destination: f.svc, path: `/konsole/MainWindow_${f.num}`,
        interface: 'org.kde.KMainWindow', member: 'activateAction',
        signature: 's', body: [name],
      }));
      return true;
    } catch { return false; }
  }, []);

  const newTab = useCallback(async () => {
    if (!(await activateWindowAction('new-tab'))) await windowRef.current?.newSession('', '');
  }, [activateWindowAction]);

  const nextTab = useCallback(async () => {
    if (!(await activateWindowAction('next-tab'))) await windowRef.current?.nextSession();
  }, [activateWindowAction]);

  const prevTab = useCallback(async () => {
    if (!(await activateWindowAction('previous-tab'))) await windowRef.current?.prevSession();
  }, [activateWindowAction]);

  const closeTab = useCallback(() => {
    keys.pressCombo([KEY.LEFTCTRL, KEY.LEFTSHIFT, KEY.KEY_W]);
  }, []);

  // Ctrl+U clears the current line in bash, zsh, and fish before injecting the suggestion.
  // History suggestions run immediately; completion suggestions only fill the line
  // (padded so the next poll offers completions for the following token).
  const sendSuggestion = useCallback(async (s: Suggestion) => {
    const svc = serviceRef.current;
    const id  = activeIdRef.current;
    if (!svc || id === null) return;
    try {
      const sess = await getSessionIface(svc, id);
      await sess.sendText('\x15' + s.cmd + (s.execute ? '\r' : tokenPad(s.cmd)));
      lastInputRef.current = '';
      setSuggestions([]);
    } catch (e) {
      // Konsole ≥22.04 gates sendText behind KonsoleWindow/EnableSecuritySensitiveDBusAPI in konsolerc
      console.error('konsole sendText failed:', e instanceof Error ? e.message : e);
    }
  }, [getSessionIface]);

  return {
    connected,
    sessions,
    activeId,
    tabCount,
    activeTabIdx,
    status,
    suggestions,
    newTab,
    closeTab,
    nextTab,
    prevTab,
    sendSuggestion,
  };
}
