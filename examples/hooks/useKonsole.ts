import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { useState, useEffect, useRef, useCallback } from 'react';
import { keys } from '../keyInjector';
import { KEY } from 'react-drm';
import dbus, { MessageBus, ClientInterface } from 'dbus-next';
import { Fzf, byLengthAsc } from 'fzf';

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

async function findKonsoleService(bus: MessageBus): Promise<string | null> {
  const obj   = await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus');
  const iface = obj.getInterface('org.freedesktop.DBus');
  const names: string[] = await iface.ListNames();
  return names.find(n => n.startsWith('org.kde.konsole')) ?? null;
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

  const busRef         = useRef<MessageBus | null>(null);
  const serviceRef     = useRef<string | null>(null);
  const windowRef      = useRef<ClientInterface | null>(null);
  const activeIdRef    = useRef<number | null>(null);
  const activeSessRef  = useRef<ClientInterface | null>(null);
  const shellPidRef    = useRef<number | null>(null);
  const sessCache      = useRef<Map<number, ClientInterface>>(new Map());
  const titleMap       = useRef<Map<number, string>>(new Map());
  const fzfRef         = useRef<Fzf<string[]> | null>(null);
  const histSetRef     = useRef<Set<string>>(new Set());
  const orderedRef     = useRef<string[]>([]);
  const metaRef        = useRef<Map<string, CmdMeta>>(new Map());
  const toolsCacheRef  = useRef<{ cwd: string; tools: Set<string> } | null>(null);
  const histWatcherRef = useRef<fs.FSWatcher | null>(null);
  const lastInputRef   = useRef('');
  const predKeyRef     = useRef<string | null>(null);

  activeIdRef.current = activeId;

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

  const attachService = useCallback(async (svc: string, bus: MessageBus) => {
    try {
      const obj = await bus.getProxyObject(svc, '/Windows/1');
      const win = obj.getInterface('org.kde.konsole.Window');

      windowRef.current  = win;
      serviceRef.current = svc;
      sessCache.current.clear();
      titleMap.current.clear();

      // No live setup beyond this: konsole's Window/Session D-Bus interfaces expose
      // no signals (sessionAdded/currentSessionChanged/titleChanged don't exist),
      // so the 300ms poll below keeps sessions, titles, and the active tab in sync.
      const curId: number = Number(await win.currentSession());
      setActiveId(curId);
      activeIdRef.current = curId;
      setConnected(true);
      await switchActiveSess(svc, curId);
    } catch {}
  }, [flushSessions, getSessionIface, switchActiveSess]);

  useEffect(() => {
    let alive = true;
    const bus = dbus.sessionBus();
    busRef.current = bus;

    async function init() {
      const dbusObj   = await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus');
      const dbusIface = dbusObj.getInterface('org.freedesktop.DBus');

      dbusIface.on('NameOwnerChanged', async (name: string, _old: string, newOwner: string) => {
        if (!alive || !name.startsWith('org.kde.konsole')) return;
        if (newOwner && !serviceRef.current) {
          await attachService(name, bus);
        } else if (!newOwner && serviceRef.current === name) {
          windowRef.current     = null;
          serviceRef.current    = null;
          activeSessRef.current = null;
          shellPidRef.current   = null;
          sessCache.current.clear();
          titleMap.current.clear();
          histWatcherRef.current?.close();
          setSessions([]);
          setActiveId(null);
          setConnected(false);
          setSuggestions([]);
          setStatus({ cwd: '', isRunning: false, foregroundCmd: '' });
        }
      });

      const svc = await findKonsoleService(bus);
      if (alive && svc) await attachService(svc, bus);
    }

    init().catch(() => {});

    const timer = setInterval(async () => {
      if (!alive) return;
      try {
        // ── Tab/session sync — konsole exposes no D-Bus signals, so poll ──
        const win = windowRef.current;
        const svc = serviceRef.current;
        if (!win || !svc) return;
        const [rawIds, curRaw] = await Promise.all([win.sessionList(), win.currentSession()]);
        if (!alive) return;
        const ids   = (rawIds as (string | number)[]).map(Number);
        const curId = Number(curRaw);

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
    }, 300);

    return () => {
      alive = false;
      clearInterval(timer);
      histWatcherRef.current?.close();
      bus.disconnect();
    };
  }, [attachService]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const newTab = useCallback(async () => {
    await windowRef.current?.newSession('', '');
  }, []);

  const nextTab = useCallback(async () => {
    await windowRef.current?.nextSession();
  }, []);

  const prevTab = useCallback(async () => {
    await windowRef.current?.prevSession();
  }, []);

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
    status,
    suggestions,
    newTab,
    closeTab,
    nextTab,
    prevTab,
    sendSuggestion,
  };
}
