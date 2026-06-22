import React, { useState, useEffect, useRef, useContext } from 'react';
import { useAtom } from 'jotai';
import {
  POMO_SESSION,
  pomoElapsedAtom, pomoRunningAtom, pomoSessionsAtom, pomoFlashAtom,
} from '../store/pomodoro';
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { Box, Text, Button, LayoutContext, NativeDrawContext, DisplaySizeContext } from 'react-drm';
import type { BoxNode } from 'react-drm';
import { MdArrowDownward, MdArrowUpward, MdCancel, MdDeveloperBoard, MdDeviceHub, MdMemory, MdReplay, MdRouter, MdThermostat, MdWhatshot, MdWifi } from 'react-icons/md';
import type { IconType } from 'react-icons';
import { CAVA, SYSTEMBAR } from '../config';
import { useLayers } from './index';
import { BackButton } from '../components/BackButton';

// ── Colors ────────────────────────────────────────────────────────────────────
const BG      = '#0d1117';
const MOD_BG  = '#111827';   // module background (slightly lighter)
const SEP_CLR = '#1e293b';   // separator / border color

function loadColor(pct: number) {
  if (pct < 50) return '#4ade80';
  if (pct < 80) return '#fde047';
  return '#f87171';
}
function tempColor(c: number) {
  if (c < 65) return '#4ade80';
  if (c < 82) return '#fde047';
  return '#f87171';
}
type BatteryState = 'Charging' | 'Discharging' | 'Full' | 'Unknown';
interface BatteryInfo { pct: number; state: BatteryState; }

function batteryState(raw: string): BatteryState {
  if (raw === 'Charging') return 'Charging';
  if (raw === 'Discharging') return 'Discharging';
  if (raw === 'Full') return 'Full';
  return 'Unknown';
}

function batteryRange(pct: number): 'critical' | 'low' | 'medium' | 'high' | 'full' {
  if (pct <= 10) return 'critical';
  if (pct <= 25) return 'low';
  if (pct <= 50) return 'medium';
  if (pct <= 85) return 'high';
  return 'full';
}

function batColor(bat: BatteryInfo) {
  if (bat.state === 'Charging') return '#4ade80';
  if (bat.state === 'Full') return '#34d399';
  const range = batteryRange(bat.pct);
  if (range === 'critical') return '#ef4444';
  if (range === 'low') return '#f87171';
  if (range === 'medium') return '#fde047';
  return '#cccccc';
}
function fmtRate(bps: number) {
  if (bps >= 1e6) return (bps / 1e6).toFixed(1) + 'M';
  if (bps >= 1e3) return (bps / 1e3).toFixed(0) + 'K';
  return bps + 'B';
}
const NET_WIDTH_TEST = false;
const NET_TEST_RX_BPS = 999_900_000;
const NET_TEST_TX_BPS = 999_900_000;

function sparkPoints(values: number[], width: number, height: number) {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  return values.map((v, i) => {
    const x = i * step;
    const y = height - Math.round((v / max) * height);
    return `${x},${y}`;
  }).join(' ');
}
function fmtGiB(b: number) { return (b / 1024 ** 3).toFixed(1) + 'G'; }
function fmtIface(iface: string) {
  const match = iface.match(/^(wlan)(\d+)$/);
  if (!match) return iface;
  return `${match[1]}${match[2].padStart(2, '0')}`;
}

function ifaceIcon(iface: string) {
  if (/^(wlan|wifi|wl)/i.test(iface)) return MdWifi;
  if (/^(eth|enp|eno|ens|tap|tun|usb|lan)/i.test(iface)) return MdRouter;
  return MdDeviceHub;
}

// ── System readers ─────────────────────────────────────────────────────────────
interface CpuTick { total: number; idle: number; }
interface NetSample { iface: string; counters: Map<string, { rx: number; tx: number }>; }
const IFACE_SKIP = /^(lo|CloudflareWARP|t2_ncm|docker|veth|br-|virbr)/;

function tickCpu(): CpuTick[] {
  return readFileSync('/proc/stat', 'utf8').split('\n').filter(l => /^cpu\d/.test(l))
    .map(l => { const n = l.split(/\s+/).slice(1).map(Number); return { total: n.reduce((s, v) => s + v, 0), idle: n[3] + (n[4] ?? 0) }; });
}
function calcUsage(a: CpuTick[], b: CpuTick[]): number[] {
  return b.map((t, i) => { const dt = t.total - a[i].total, di = t.idle - a[i].idle; return dt > 0 ? Math.max(0, Math.min(100, Math.round(100 * (1 - di / dt)))) : 0; });
}
function readMem() {
  const txt = readFileSync('/proc/meminfo', 'utf8');
  const kv  = (k: string) => parseInt(txt.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'))?.[1] ?? '0');
  const total = kv('MemTotal') * 1024;
  return { used: total - kv('MemAvailable') * 1024, total };
}
function readTemp(): number | null {
  try {
    for (const d of readdirSync('/sys/class/hwmon')) {
      try {
        const name = readFileSync(`/sys/class/hwmon/${d}/name`, 'utf8').trim();
        if (/coretemp|k10temp|zenpower/.test(name))
          return Math.round(parseInt(readFileSync(`/sys/class/hwmon/${d}/temp1_input`, 'utf8').trim()) / 1000);
      } catch { /**/ }
    }
  } catch { /**/ }
  for (let i = 0; i < 10; i++) {
    try {
      const c = Math.round(parseInt(readFileSync(`/sys/class/thermal/thermal_zone${i}/temp`, 'utf8').trim()) / 1000);
      if (c >= 20 && c <= 110) return c;
    } catch { /**/ }
  }
  return null;
}
// The active adapter is the one holding the default route (lowest metric) — NOT the one
// with the most lifetime traffic, otherwise Wi-Fi's since-boot total always wins even when
// you're on Ethernet / phone tether. Falls back to a non-down interface, then to anything.
function activeIface(counters: Map<string, { rx: number; tx: number }>): string {
  try {
    const lines = readFileSync('/proc/net/route', 'utf8').split('\n').slice(1);
    let route: { iface: string; metric: number } | null = null;
    for (const line of lines) {
      const f = line.trim().split(/\s+/);
      if (f.length < 11) continue;
      const iface = f[0], dest = f[1], metric = parseInt(f[6], 10);
      if (dest !== '00000000' || IFACE_SKIP.test(iface)) continue; // 00000000 = default route
      if (!route || metric < route.metric) route = { iface, metric };
    }
    if (route) return route.iface;
  } catch { /* no default route yet — fall through */ }

  let fallback: string | null = null;
  let bestBytes = -1;
  for (const [iface, c] of counters) {
    let usable = false;
    try {
      // USB tethers / point-to-point links report operstate 'unknown' even when working.
      const state = readFileSync(`/sys/class/net/${iface}/operstate`, 'utf8').trim();
      usable = state !== 'down' && state !== 'lowerlayerdown';
    } catch { /* ignore */ }
    if (usable && c.rx + c.tx > bestBytes) { fallback = iface; bestBytes = c.rx + c.tx; }
  }
  return fallback ?? counters.keys().next().value ?? '?';
}

function tickNet(): NetSample {
  const counters = new Map<string, { rx: number; tx: number }>();
  const lines = readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2);
  for (const line of lines) {
    const p = line.trim().split(/\s+/), iface = p[0].replace(':', '');
    if (!iface || IFACE_SKIP.test(iface)) continue;
    counters.set(iface, { rx: parseInt(p[1]), tx: parseInt(p[9]) });
  }
  return { iface: activeIface(counters), counters };
}
function readBattery(): BatteryInfo | null {
  for (const b of ['/sys/class/power_supply/BAT0', '/sys/class/power_supply/BAT1']) {
    try {
      const pct = parseInt(readFileSync(`${b}/capacity`, 'utf8').trim());
      const state = batteryState(readFileSync(`${b}/status`, 'utf8').trim());
      return { pct, state };
    } catch { /**/ }
  }
  return null;
}
function readHostname() { try { return readFileSync('/etc/hostname', 'utf8').trim(); } catch { return 'localhost'; } }
function readUptime() {
  try {
    const s = parseFloat(readFileSync('/proc/uptime', 'utf8').split(' ')[0] ?? '0');
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h${m}m` : `${m}m`;
  } catch { return ''; }
}

const HOSTNAME  = readHostname();
const INIT_BAT  = readBattery();
const HAS_BAT   = INIT_BAT !== null;
const NUM_CORES = tickCpu().length;

// ── Polybar primitives ────────────────────────────────────────────────────────

// Module wrapper — raised background, horizontal padding, vertically centered
function Mod({ children, width }: { children: React.ReactNode; width: number }) {
  return (
    <Box style={{
      flexDirection: 'row', alignItems: 'center', gap: 8,
      justifyContent: 'center',
      paddingHorizontal: 20,
      alignSelf: 'stretch',
      width,
    }}>
      {children}
    </Box>
  );
}

// Thin vertical separator between modules
function Sep() {
  return <Box style={{ width: 1, height: 28, backgroundColor: SEP_CLR }} />;
}

// Accent label (the small dim prefix like "CPU", "MEM")
function Label({ children }: { children: string }) {
  return <Text style={{ color: '#cccccc', fontSize: 17, fontFamily: 'FiraCode Nerd Font Mono' }}>{children}</Text>;
}

// Main value text
function Val({ children, color = '#cccccc' }: { children:string; color?: string }) {
  return <Text style={{ color, fontSize: 22, fontFamily: 'FiraCode Nerd Font Mono' }}>{children}</Text>;
}

// Thin inline bar (polybar ramp-like)
function Bar({ fill, color, width = 60 }: { fill: number; color: string; width?: number }) {
  return (
    <Box style={{ width, height: 6, backgroundColor: '#1e293b' }}>
      {fill > 0 && <Box style={{ width: Math.round(width * fill), height: 6, backgroundColor: color }} />}
    </Box>
  );
}

// Rolling-history length used by the net sparkline.
const HIST_LEN = 24;

// Push v onto a fixed-length ring (drops the oldest). Pure — returns a new array.
function pushHist(hist: number[], v: number): number[] {
  return [...hist.slice(1), v];
}

// ── Modules ───────────────────────────────────────────────────────────────────

// Clean, uniform stat tile: colored icon + value. Left-aligned + fixed width so
// CPU/MEM/TEMP line up into matching columns. The icon stands in for the label.
function StatTile({ icon: Icon, value, color }: {
  icon: IconType; value: string; color: string;
}) {
  return (
    <Box style={{
      flexDirection: 'row', alignItems: 'center', gap: 2,
      paddingHorizontal: 20, alignSelf: 'stretch', width: 150,
      justifyContent: 'center',
    }}>
      <Icon style={{ width: 26, height: 26 }} fill={color} stroke="none" />
      <Text style={{ color, fontSize: 22, fontFamily: 'FiraCode Nerd Font Mono' }}>{value}</Text>
    </Box>
  );
}

function CpuMod({ cores }: { cores: number[] }) {
  const avg = Math.round(cores.reduce((s, v) => s + v, 0) / cores.length);
  return <StatTile icon={MdDeveloperBoard} value={`${avg}%`} color={loadColor(avg)} />;
}

function MemMod({ used, total }: { used: number; total: number }) {
  const pctN = total > 0 ? Math.round((used / total) * 100) : 0;
  return <StatTile icon={MdMemory} value={`${pctN}%`} color={loadColor(pctN)} />;
}

function TempMod({ temp }: { temp: number | null }) {
  const color = temp !== null ? tempColor(temp) : '#475569';
  return <StatTile icon={MdThermostat} value={temp !== null ? `${temp}°C` : 'N/A'} color={color} />;
}

function NetMod({ rx, tx, iface, rxHist, txHist }: { rx: number; tx: number; iface: string; rxHist: number[]; txHist: number[] }) {
  const rxValue = NET_WIDTH_TEST ? NET_TEST_RX_BPS : rx;
  const txValue = NET_WIDTH_TEST ? NET_TEST_TX_BPS : tx;

  const NetIcon = ifaceIcon(iface);

  const chartW = 160;
  const chartH =44;
  const sharedMax = Math.max(1, ...rxHist, ...txHist);
  const normalize = (v: number) => Math.round((v / sharedMax) * chartH);
  const rxPts = rxHist.map((v, i) => {
    const x = rxHist.length > 1 ? (i * chartW) / (rxHist.length - 1) : chartW;
    const y = chartH - normalize(v);
    return `${x},${y}`;
  }).join(' ');
  const txPts = txHist.map((v, i) => {
    const x = txHist.length > 1 ? (i * chartW) / (txHist.length - 1) : chartW;
    const y = chartH - normalize(v);
    return `${x},${y}`;
  }).join(' ');
  const rxFillW = Math.round(chartW * Math.min(1, Math.max(0, rxValue / sharedMax)));
  const txFillW = Math.round(chartW * Math.min(1, Math.max(0, txValue / sharedMax)));

  return (
    <Box style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 20,
      alignSelf: 'stretch',
      width: 266,
    }}>
      <NetIcon x={16} y={4} style={{ width: 18, height: 18 }} fill="#cbd5e1" stroke="none" />
      <svg width={chartW} height={chartH} viewBox={`0 0 ${chartW} ${chartH}`}>
        <rect x={0} y={0} width={chartW} height={chartH} rx={3} fill="#000" />
        <rect x={0} y={chartH - 5} width={chartW} height={2} rx={1} fill="#1e293b" />
        {rxFillW > 0 && <rect x={0} y={chartH - 5} width={rxFillW} height={2} rx={1} fill="#7dd3fc" opacity={0.35} />}
        {txFillW > 0 && <rect x={0} y={chartH - 2} width={txFillW} height={2} rx={1} fill="#fdba74" opacity={0.35} />}
        <polyline fill="none" stroke="#7dd3fc" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" points={rxPts} />
        <polyline fill="none" stroke="#fdba74" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" points={txPts} />
      </svg>
      <Box style={{ gap: 1,flexDirection:"column" }}>
        <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <MdArrowDownward style={{ width: 14, height: 14 }} fill="#7dd3fc" stroke="none" />
          <Text style={{ color: '#7dd3fc', fontSize: 15, fontFamily: 'FiraCode Nerd Font Mono' }}>{fmtRate(rxValue)}</Text>

        </Box>
        <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <MdArrowUpward style={{ width: 14, height: 14 }} fill="#fdba74" stroke="none" />
          <Text style={{ color: '#fdba74', fontSize: 15, fontFamily: 'FiraCode Nerd Font Mono' }}>{fmtRate(txValue)}</Text>
        </Box>
      </Box>
    </Box>
  );
}

function HostMod({ uptime }: { uptime: string }) {
  return (
    <Mod width={240}>
      <Box style={{ width: 6, height: 6, backgroundColor: '#22c55e' }} />
      <Val color="#c7d2fe">{HOSTNAME}</Val>
      {uptime ? <Label>{`↑${uptime}`}</Label> : null}
    </Mod>
  );
}

function BatteryIcon({ bat }: { bat: BatteryInfo }) {
  const bodyW = 34;
  const bodyH = 16;
  const nubW = 3;
  const nubH = 7;
  const level = Math.max(0, Math.min(100, bat.pct));
  const innerPad = 0;
  const fillW = Math.max(0, Math.round((bodyW - innerPad * 2) * level / 100));
  const color = batColor(bat);
  const range = batteryRange(level);
  const showCritical = range === 'critical' && bat.state !== 'Charging';
  const showCharging = bat.state === 'Charging';
  const showFull = bat.state === 'Full';
  const bodyY = (20 - bodyH) / 2;

  return (
    <svg width={40} height={20} viewBox="0 0 40 20">
      <defs>
        <linearGradient id="batFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="40%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor={color} stopOpacity="0.92" />
        </linearGradient>
      </defs>

      <rect x={35} y={(20 - nubH) / 2} width={nubW} height={nubH} rx={1} fill="#9ca3af" />
      <rect x={0.8} y={bodyY} width={bodyW} height={bodyH} rx={4.5} fill="#0f141a" stroke="#cbd5e1" strokeOpacity={0.65} strokeWidth={1.6} />
      <rect x={innerPad + 0.8} y={bodyY + innerPad} width={bodyW - innerPad * 2} height={bodyH - innerPad * 2} rx={2.8} fill="#111827" />

      {fillW > 0 && (
        <rect
          x={innerPad + 0.8}
          y={bodyY + innerPad}
          width={fillW}
          height={bodyH - innerPad * 2}
          rx={2.8}
          fill="url(#batFill)"
        />
      )}

      {fillW > 2 && (
        <rect
          x={innerPad + 1.6}
          y={bodyY + innerPad + 1}
          width={Math.max(0, fillW - 2)}
          height={Math.max(0, (bodyH - innerPad * 2) / 2 - 1)}
          rx={2}
          fill="#cccccc"
          opacity={0.14}
        />
      )}

      {showCharging && (
        <path
          d="M17.6 5.4 L15 10.1 H18.1 L15.9 14.6 L22.2 8.8 H18.9 L21 5.4 Z"
          fill="#e5e7eb"
          opacity={0.92}
        />
      )}

      {showFull && (
        <path
          d="M13.8 10.2 L16.5 12.9 L21.4 8"
          stroke="#e5e7eb"
          strokeWidth={1.9}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {showCritical && (
        <>
          <rect x={17.2} y={6.4} width={1.8} height={5.1} rx={0.9} fill="#fee2e2" />
          <rect x={17.2} y={12.5} width={1.8} height={1.8} rx={0.9} fill="#fee2e2" />
        </>
      )}

      <circle cx={39} cy={10} r={0.8} fill={color} opacity={0.85} />
    </svg>
  );
}

function BatMod({ bat }: { bat: BatteryInfo | null }) {
  if (!bat) return null;
  const color = batColor(bat);
  const range = batteryRange(bat.pct);
  const stateText = bat.state === 'Charging'
    ? 'CHG'
    : bat.state === 'Full'
      ? 'FULL'
      : range === 'critical'
        ? 'CRIT'
        : range === 'low'
          ? 'LOW'
          : range === 'medium'
            ? 'MED'
            : 'HIGH';

  return (
    <Mod width={160}>
      {/* <Label>{stateText}</Label> */}
      <BatteryIcon bat={bat} />
      <Val color={color}>{`${bat.pct}%`}</Val>
    </Mod>
  );
}

// Clock gets a distinct accent bg to stand out (polybar convention)
function ClockMod({ time }: { time: Date }) {
  const hh = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dd = time.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <Box style={{
       alignItems: 'center', 
      // backgroundColor: '#1e1b4b',
      paddingHorizontal: 20,
      justifyContent: 'center',
      // alignSelf: 'stretch',
      gap: 6,
 
    }}>
      <Text style={{ color: '#fde68a', fontSize: 20, fontFamily: 'IosevkaTerm Nerd Font' }}>{hh}</Text>
      <Text style={{ color: '#94a3b8', fontSize: 14, fontFamily: 'IosevkaTerm Nerd Font' }}>{dd}</Text>
    </Box>
  );
}

// ── Audio Visualizer ─────────────────────────────────────────────────────────
const CAVA_BARS = CAVA.bars;
const CAVA_CFG  = '/tmp/.react-drm-cava.conf';
const CAVA_MAX_HEIGHT = 34;

try {
  writeFileSync(CAVA_CFG, [
    '[general]',
    `bars = ${CAVA_BARS}`,
    `framerate = ${CAVA.framerate}`,
    '[input]',
    'method = pulse',
    'source = auto',
    '[output]',
    'method = raw',
    'raw_target = /dev/stdout',
    'data_format = binary',
    'channels = mono',
    'bit_format = 8bit',
  ].join('\n'));
} catch { /**/ }

// orange (bass) → cyan (treble)
const BAR_COLORS = Array.from({ length: CAVA_BARS }, (_, i) => {
  const t = i / (CAVA_BARS - 1);
  const r = Math.round(249 - t * 215);
  const g = Math.round(115 + t *  96);
  const b = Math.round( 22 + t * 216);
  const hex = (v: number) => Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
});

const BAR_W = 10;
const GAP   = 3;
const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const BAR_RGB      = BAR_COLORS.flatMap(hexRgb);                              // flat r,g,b per bar (active)
const INACTIVE_RGB = Array.from({ length: CAVA_BARS }, () => hexRgb('#1e293b')).flat();

function AudioVisSection() {
  const layoutRef  = useContext(LayoutContext);
  const native     = useContext(NativeDrawContext);
  const { height: dispH } = useContext(DisplaySizeContext);
  const barsRef    = useRef<BoxNode>(null);
  const heightsRef = useRef<number[]>(new Array(CAVA_BARS).fill(2));
  const [, force]  = useState(0);

  useEffect(() => {
    let partial: Buffer = Buffer.alloc(0);
    let prev = new Array(CAVA_BARS).fill(2);
    const proc = spawn('cava', ['-p', CAVA_CFG]);
    proc.stdout?.on('data', (chunk: Buffer) => {
      partial = partial.length ? Buffer.concat([partial, chunk]) : chunk;
      const whole = partial.length - (partial.length % CAVA_BARS);
      if (whole < CAVA_BARS) return;
      const frame = partial.slice(whole - CAVA_BARS, whole); // newest complete frame
      partial = whole < partial.length ? partial.slice(whole) : Buffer.alloc(0);
      const heights = Array.from(frame, v => Math.max(2, Math.round((v / 255) * CAVA_MAX_HEIGHT)));
      if (heights.every((h, i) => h === prev[i])) return;
      prev = heights;
      heightsRef.current = heights;

      // Native fast path: draw straight into the FB at the bars' laid-out box
      // (off the React commit loop → no full-tree layout/serialize). The box's
      // bottom edge + centered x are stable (bottom/center-aligned), so coords
      // are correct even between commits.
      const node = barsRef.current;
      const box = node ? layoutRef.current.get(node) : undefined;
      if (native && box) {
        const active = heights.some(h => h > 2);
        native.drawBars({
          x0: box.x, baseY: box.y + box.h, barW: BAR_W, gap: GAP, fullHeight: dispH,
          bg: [0, 0, 0], heights, colors: active ? BAR_RGB : INACTIVE_RGB,
        });
      } else {
        force(n => n + 1); // no native/layout yet → fall back to a React re-render
      }
    });
    return () => { try { proc.kill('SIGTERM'); } catch { /**/ } };
  }, [native, dispH, layoutRef]);

  // React render (from the ref) keeps the bars correct on commits + establishes
  // the layout box native reads; the native path overdraws live between commits.
  const bars = heightsRef.current;
  const isActive = bars.some(h => h > 2);
  return (
    <Box style={{ flex: 1, alignItems: 'flex-end', justifyContent: 'center', paddingHorizontal: 8, paddingBottom: 8 }}>
      <Box ref={barsRef} style={{ alignItems: 'flex-end', gap: GAP }}>
        {bars.map((h, i) => (
          <Box key={i} style={{ width: BAR_W, height: h, backgroundColor: isActive ? BAR_COLORS[i] : '#1e293b' }} />
        ))}
      </Box>
    </Box>
  );
}

// ── Pomodoro ──────────────────────────────────────────────────────────────────
const POMO_R    = 15;
const POMO_CIRC = 2 * Math.PI * POMO_R;

function PomodoroSection() {
  const [elapsed,  setElapsed]  = useAtom(pomoElapsedAtom);
  const [running,  setRunning]  = useAtom(pomoRunningAtom);
  const [sessions, setSessions] = useAtom(pomoSessionsAtom);
  const [flash,    setFlash]    = useAtom(pomoFlashAtom);

  // Ring fills over current 25-min block
  const sessionProgress = elapsed === 0 ? 0 : (elapsed % POMO_SESSION) / POMO_SESSION;
  const dash = (sessionProgress * POMO_CIRC).toFixed(1);
  const gap  = POMO_CIRC.toFixed(1);

  // Stopwatch display: MM:SS up to 99:59, then H:MM
  const totalMins = Math.floor(elapsed / 60);
  const secs      = elapsed % 60;
  const display   = totalMins < 100
    ? `${String(totalMins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`
    : `${Math.floor(totalMins/60)}:${String(totalMins%60).padStart(2,'0')}`;

  const ringColor = flash ? '#4ade80' : running ? '#f87171' : elapsed > 0 ? '#475569' : '#334155';
  const timeColor = flash ? '#86efac' : running ? '#fca5a5' : elapsed > 0 ? '#94a3b8' : '#64748b';
  const label     = flash ? `session ${sessions} done!`
                  : !running && elapsed === 0 ? 'tap to start'
                  : running ? 'focus' : 'paused';
  const labelColor = flash ? '#4ade80' : '#475569';

  // Dots: fill per session within each 4-session cycle; flash shows all 4 filled
  const filledDots = flash && sessions % 4 === 0 && sessions > 0 ? 4 : sessions % 4;

  function toggle() { setRunning(r => !r); }
  function reset()  { setElapsed(0); setRunning(false); setSessions(0); setFlash(false); }
  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 2, gap: 8 }}>
      <Button  onClick={toggle} color="transparent" activeColor="#1e293b"
         style={{ alignItems: 'center', justifyContent: 'center' , gap: 8 }}>
        <svg width={38} height={38} viewBox="0 0 38 38">
          <circle cx={19} cy={19} r={POMO_R} fill="none" stroke="#1e293b" strokeWidth={3} />
          <circle cx={19} cy={19} r={POMO_R} fill="none"
            stroke={ringColor} strokeWidth={3}
            strokeDasharray={`${dash} ${gap}`}
            strokeLinecap="round"
            transform="rotate(-90 19 19)"
          />
        </svg>
      <Text style={{ fontSize: 28, color: timeColor, fontFamily: 'IosevkaTerm Nerd Font' }}>{display}</Text>
      <Text style={{ fontSize: 18, color: labelColor, fontFamily: 'IosevkaTerm Nerd Font' }}>{label}</Text>
      </Button>
      {/* <Box style={{ flexDirection: 'row', gap: 5 }}>
        {([0,1,2,3] as const).map(i => (
          <Box key={i} style={{ width: 30, height: 30, borderRadius: 3,
            backgroundColor: i < filledDots ? '#f87171' : '#cccccc' }} />
        ))}
      </Box> */}
      {(running || elapsed > 0) && (
        <Button onClick={reset}  color='transparent' activeColor="#1e293b"
          width={38} height={38} style={{ alignItems: 'center', justifyContent: 'center' }}>
          <MdReplay style={{ width: 38, height: 38 }} fill="#475569" stroke="none" />
        </Button>
      )}
    </Box>
  );
}

// ── State ─────────────────────────────────────────────────────────────────────
interface State {
  cores: number[]; mem: { used: number; total: number }; temp: number | null;
  netRx: number; netTx: number; iface: string;
  rxHist: number[]; txHist: number[];
  uptime: string; bat: BatteryInfo | null; time: Date;
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function SystemBar({ width, height }: { width: number; height: number }) {
  const { go } = useLayers();

  const [s, setS] = useState<State>({
    cores: new Array(NUM_CORES).fill(0), mem: readMem(), temp: readTemp(),
    netRx: 0, netTx: 0, iface: '',
    rxHist: new Array(HIST_LEN).fill(0), txHist: new Array(HIST_LEN).fill(0),
    uptime: readUptime(), bat: INIT_BAT, time: new Date(),
  });

  useEffect(() => {
    let prevCpu = tickCpu(), prevNet = tickNet(), prevTime = Date.now();
    // All rolling histories live here (not in child effects) so one poll = one
    // commit. A child effect pushing history adds a second render+blit per tick,
    // which showed up as a hitch in the audio bars on the stats timer.
    let rxHist = new Array(HIST_LEN).fill(0), txHist = new Array(HIST_LEN).fill(0);
    const id = setInterval(() => {
      try {
        const nextCpu = tickCpu(), nextNet = tickNet(), now = Date.now();
        const dt = Math.max(0.2, (now - prevTime) / 1000);
        // Rate is computed from the active interface's own prev/next counters, so switching
        // adapters (e.g. unplugging the tether) never subtracts two different interfaces.
        const cur = nextNet.counters.get(nextNet.iface), prev = prevNet.counters.get(nextNet.iface);
        const netRx = cur && prev ? Math.max(0, Math.round((cur.rx - prev.rx) / dt)) : 0;
        const netTx = cur && prev ? Math.max(0, Math.round((cur.tx - prev.tx) / dt)) : 0;
        rxHist = pushHist(rxHist, netRx);
        txHist = pushHist(txHist, netTx);
        setS({
          cores: calcUsage(prevCpu, nextCpu), mem: readMem(), temp: readTemp(),
          netRx, netTx, iface: nextNet.iface, rxHist, txHist,
          uptime: readUptime(), bat: readBattery(), time: new Date(),
        });
        prevCpu = nextCpu; prevNet = nextNet; prevTime = now;
      } catch { /**/ }
    }, SYSTEMBAR.statsPollMs);
    return () => clearInterval(id);
  }, []);

  return (
    <Box style={{ flex: 1 , gap:10  }}>

      {/* Back button */}
     
     <BackButton animation="slide-down" />
      <Sep />

      <PomodoroSection />

      <Sep />

      <AudioVisSection />

      <Sep />

      {/* Stats modules */}
      <Box style={{ }}>

      <CpuMod  cores={s.cores} />
      <Sep />
      <MemMod  used={s.mem.used} total={s.mem.total} />
      <Sep />
      <TempMod temp={s.temp} />
      <Sep />
      <NetMod  rx={s.netRx} tx={s.netTx} iface={s.iface} rxHist={s.rxHist} txHist={s.txHist} />
      {/* <Sep /> */}
      {/* <HostMod uptime={s.uptime} /> */}
      {HAS_BAT && <Sep />}
      {HAS_BAT && <BatMod bat={s.bat} />}

       <Sep /> 
      <ClockMod time={s.time} />
      </Box>

    </Box>
  );
}
