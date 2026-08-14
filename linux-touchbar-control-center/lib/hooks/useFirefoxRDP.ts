// @ts-ignore — foxdriver has no type declarations
import Foxdriver from '@benmalka/foxdriver';
import { useState, useEffect, useCallback, useRef } from 'react';

export interface FxTab {
  id:    string;   // foxdriver actor name
  title: string;
  url:   string;
  _raw:  any;      // foxdriver Tab object
}

export interface FirefoxRDP {
  connected: boolean;
  tabs:      FxTab[];
  activeId:  string | null;
  back():              void;
  forward():           void;
  reload():            void;
  newTab():            void;
  closeTab(id?: string): void;
  prevTab():           void;
  nextTab():           void;
  switchTab(id: string): void;
}

// Firefox must be started with:
//   firefox -start-debugger-server 6000
// and about:config prefs:
//   devtools.chrome.enabled          = true
//   devtools.debugger.remote-enabled = true
//   devtools.debugger.prompt-connection = false
const RDP_PORT = 9222;

function safeEval(tab: any, expr: string): void {
  tab?.console?.evaluateJS(expr).catch(() => {});
}

export function useFirefoxRDP(): FirefoxRDP {
  const [tabs,      setTabs]      = useState<FxTab[]>([]);
  const [activeId,  setActiveId]  = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const browserRef  = useRef<any>(null);
  const activeIdRef = useRef<string | null>(null);
  const tabsRef     = useRef<FxTab[]>([]);
  activeIdRef.current = activeId;
  tabsRef.current     = tabs;

  function activeTab(): any {
    return tabsRef.current.find(t => t.id === activeIdRef.current)?._raw ?? null;
  }

  const refreshTabs = useCallback(async (browser: any) => {
    try {
      const raw: any[] = await browser.listTabs();
      const fxTabs: FxTab[] = raw.map(t => ({
        id:   t.name,
        title: t.data?.title || t.data?.url || 'New Tab',
        url:   t.data?.url   || '',
        _raw:  t,
      }));
      setTabs(fxTabs);
      tabsRef.current = fxTabs;
      if (!activeIdRef.current && fxTabs.length > 0) {
        setActiveId(fxTabs[0].id);
      }
    } catch { /* browser may have closed */ }
  }, []);

  useEffect(() => {
    let alive = true;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    async function connect() {
      try {
        const { browser } = await Foxdriver.attach('localhost', RDP_PORT);
        if (!alive) { browser.disconnect(); return; }

        browserRef.current = browser;
        setConnected(true);
        await refreshTabs(browser);

        // Real-time tab list updates
        browser.client.on('message', (msg: any) => {
          if (msg.type === 'tabListChanged') refreshTabs(browser);
        });

        pollTimer = setInterval(() => { if (alive) refreshTabs(browser); }, 3000);

        browser.on('end',   () => { if (alive) reconnect(); });
        browser.on('error', () => { if (alive) reconnect(); });
      } catch {
        if (alive) setTimeout(connect, 3000);
      }
    }

    function reconnect() {
      setConnected(false);
      browserRef.current = null;
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      setTimeout(connect, 3000);
    }

    connect();

    return () => {
      alive = false;
      if (pollTimer) clearInterval(pollTimer);
      browserRef.current?.disconnect();
    };
  }, [refreshTabs]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const back    = useCallback(() => safeEval(activeTab(), 'history.back()'),    []);
  const forward = useCallback(() => safeEval(activeTab(), 'history.forward()'), []);
  const reload  = useCallback(() => activeTab()?.reload().catch(() => {}),      []);

  const newTab = useCallback(() => {
    // Use root actor newTab request; fallback to window.open in active tab
    const browser = browserRef.current;
    if (browser) {
      browser.request('newTab').catch(() =>
        safeEval(activeTab(), "window.open('about:blank','_blank')")
      );
    }
  }, []);

  const closeTab = useCallback((id?: string) => {
    const tid  = id ?? activeIdRef.current;
    const tab  = tabsRef.current.find(t => t.id === tid);
    if (!tab) return;
    safeEval(tab._raw, 'window.close()');
    const rest = tabsRef.current.filter(t => t.id !== tid);
    setActiveId(rest[0]?.id ?? null);
  }, []);

  const switchTab = useCallback((id: string) => {
    setActiveId(id);
    activeIdRef.current = id;
  }, []);

  const prevTab = useCallback(() => {
    const ts = tabsRef.current;
    if (ts.length < 2) return;
    const i = ts.findIndex(t => t.id === activeIdRef.current);
    switchTab(ts[(i - 1 + ts.length) % ts.length].id);
  }, [switchTab]);

  const nextTab = useCallback(() => {
    const ts = tabsRef.current;
    if (ts.length < 2) return;
    const i = ts.findIndex(t => t.id === activeIdRef.current);
    switchTab(ts[(i + 1) % ts.length].id);
  }, [switchTab]);

  return { connected, tabs, activeId, back, forward, reload, newTab, closeTab, prevTab, nextTab, switchTab };
}
