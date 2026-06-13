import React, { useState, useEffect } from 'react';
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { Box, Text, Button } from 'react-drm';
import { MdArrowDownward, MdArrowUpward, MdCancel, MdReplay } from 'react-icons/md';
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
function batColor(pct: number, charging: boolean) {
  if (charging) return '#4ade80';
  if (pct > 40) return '#94a3b8';
  if (pct > 15) return '#fde047';
  return '#f87171';
}
function fmtRate(bps: number) {
  if (bps >= 1e6) return (bps / 1e6).toFixed(1) + 'M';
  if (bps >= 1e3) return (bps / 1e3).toFixed(0) + 'K';
  return bps + 'B';
}
function fmtGiB(b: number) { return (b / 1024 ** 3).toFixed(1) + 'G'; }
function fmtIface(iface: string) {
  const match = iface.match(/^(wlan)(\d+)$/);
  if (!match) return iface;
  return `${match[1]}${match[2].padStart(2, '0')}`;
}

// ── System readers ─────────────────────────────────────────────────────────────
interface CpuTick { total: number; idle: number; }
interface NetTick { iface: string; rx: number; tx: number; }
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
function tickNet(): NetTick {
  const lines = readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2);
  let best: NetTick | null = null;
  for (const line of lines) {
    const p = line.trim().split(/\s+/), iface = p[0].replace(':', '');
    if (!iface || IFACE_SKIP.test(iface)) continue;
    const tick = { iface, rx: parseInt(p[1]), tx: parseInt(p[9]) };
    if (!best || tick.rx + tick.tx > best.rx + best.tx) best = tick;
  }
  return best ?? { iface: '?', rx: 0, tx: 0 };
}
function readBattery(): { pct: number; charging: boolean } | null {
  for (const b of ['/sys/class/power_supply/BAT0', '/sys/class/power_supply/BAT1']) {
    try { return { pct: parseInt(readFileSync(`${b}/capacity`, 'utf8').trim()), charging: readFileSync(`${b}/status`, 'utf8').trim() === 'Charging' }; } catch { /**/ }
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
      flexDirection: 'row', alignItems: 'center', gap: 14,
      // backgroundColor: MOD_BG,
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
  return <Text style={{ color: '#fff', fontSize: 17, fontFamily: 'FiraCode Nerd Font Mono' }}>{children}</Text>;
}

// Main value text
function Val({ children, color = '#e2e8f0' }: { children:string; color?: string }) {
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

// ── Modules ───────────────────────────────────────────────────────────────────

function CpuMod({ cores }: { cores: number[] }) {
  const avg   = Math.round(cores.reduce((s, v) => s + v, 0) / cores.length);
  const color = loadColor(avg);
  return (
    <Mod width={220}>
      <Label>CPU</Label>
      <Bar fill={avg / 100} color={color} />
      <Val color={color}>{`${avg}%`}</Val>
    </Mod>
  );
}

function MemMod({ used, total }: { used: number; total: number }) {
  const pct   = total > 0 ? used / total : 0;
  const pctN  = Math.round(pct * 100);
  const color = loadColor(pctN);
  return (
    <Mod width={285}>
      <Label>MEM</Label>
      <Bar fill={pct} color={color} />
      <Val color={color}>{`${pctN}%`}</Val>
      <Label>{fmtGiB(used)}</Label>
    </Mod>
  );
}

function TempMod({ temp }: { temp: number | null }) {
  const color = temp !== null ? tempColor(temp) : '#475569';
  return (
    <Mod width={165}>
      <Label>TEMP</Label>
      <Val color={color}>{temp !== null ? `${temp}°C` : 'N/A'}</Val>
    </Mod>
  );
}

function NetMod({ rx, tx, iface }: { rx: number; tx: number; iface: string }) {
  return (
    <Box style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 20,
      alignSelf: 'stretch',
      width: 330,
    }}>
      <Label>{iface}</Label>
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <MdArrowDownward style={{ width: 16, height: 16 }} fill="#7dd3fc" stroke="none" />
        <Val color="#7dd3fc">{fmtRate(rx)}</Val>
      </Box>
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <MdArrowUpward style={{ width: 16, height: 16 }} fill="#fdba74" stroke="none" />
        <Val color="#fdba74">{fmtRate(tx)}</Val>
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

function BatMod({ bat }: { bat: { pct: number; charging: boolean } | null }) {
  if (!bat) return null;
  const color = batColor(bat.pct, bat.charging);
  return (
    <Mod width={215}>
      <Label>{bat.charging ? 'CHG' : 'BAT'}</Label>
      <Bar fill={bat.pct / 100} color={color} width={52} />
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
      paddingHorizontal: 10,
      // alignSelf: 'stretch',
      // borderLeftWidth: 2,
      // borderLeftColor: '#818cf8',
    }}>
      <Text style={{ color: '#fde68a', fontSize: 20, fontFamily: 'IosevkaTerm Nerd Font' }}>{hh}</Text>
      <Text style={{ color: '#94a3b8', fontSize: 14, fontFamily: 'IosevkaTerm Nerd Font' }}>{dd}</Text>
    </Box>
  );
}

// ── Audio Visualizer ─────────────────────────────────────────────────────────
const CAVA_BARS = 24;
const CAVA_CFG  = '/tmp/.react-drm-cava.conf';

try {
  writeFileSync(CAVA_CFG, [
    '[general]',
    `bars = ${CAVA_BARS}`,
    'framerate = 25',
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

function AudioVisSection() {
  const [bars, setBars] = useState<number[]>(new Array(CAVA_BARS).fill(0));

  useEffect(() => {
    let partial = Buffer.alloc(0);
    const proc = spawn('cava', ['-p', CAVA_CFG]);
    proc.stdout?.on('data', (chunk: Buffer) => {
      partial = Buffer.concat([partial, chunk]);
      while (partial.length >= CAVA_BARS) {
        const frame = partial.slice(0, CAVA_BARS);
        partial = partial.slice(CAVA_BARS);
        const vals: number[] = [];
        for (let i = 0; i < CAVA_BARS; i++) vals.push(frame[i] / 255);
        setBars(vals);
      }
    });
    return () => { try { proc.kill('SIGTERM'); } catch { /**/ } };
  }, []);

  const isActive = bars.some(b => b > 0.04);
  const BAR_W = 7;
  const GAP   = 2;
  const MAX_H = 34;

  return (
    <Box style={{ flex: 1, alignItems: 'flex-end',justifyContent:"center", paddingHorizontal: 8, paddingBottom:18 }}>
      <Box style={{ alignItems: 'flex-end', gap: GAP  }}>
        {bars.map((v, i) => (
          <Box key={i} style={{
            width: BAR_W,
            height: Math.max(2, Math.round(v * MAX_H)),
            backgroundColor: isActive ? BAR_COLORS[i] : '#1e293b',
          }} />
        ))}
      </Box>
    </Box>
  );
}

// ── Pomodoro ──────────────────────────────────────────────────────────────────
const POMO_SESSION = 25 * 60;
const POMO_R       = 15;
const POMO_CIRC    = 2 * Math.PI * POMO_R;

function PomodoroSection() {
  const [elapsed,  setElapsed]  = useState(0);
  const [running,  setRunning]  = useState(false);
  const [sessions, setSessions] = useState(0);
  const [flash,    setFlash]    = useState(false);

  // Tick every second
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Auto-mark session at every 25-min boundary
  useEffect(() => {
    if (elapsed === 0 || elapsed % POMO_SESSION !== 0) return;
    setSessions(s => s + 1);
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 2500);
    return () => clearTimeout(t);
  }, [elapsed]);

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
    <Box style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 12 }}>
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
            backgroundColor: i < filledDots ? '#f87171' : '#fff' }} />
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
  uptime: string; bat: { pct: number; charging: boolean } | null; time: Date;
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function SystemBar({ width, height }: { width: number; height: number }) {
  const { go } = useLayers();

  const [s, setS] = useState<State>({
    cores: new Array(NUM_CORES).fill(0), mem: readMem(), temp: readTemp(),
    netRx: 0, netTx: 0, iface: '', uptime: readUptime(), bat: INIT_BAT, time: new Date(),
  });

  useEffect(() => {
    let prevCpu = tickCpu(), prevNet = tickNet(), prevTime = Date.now();
    const id = setInterval(() => {
      try {
        const nextCpu = tickCpu(), nextNet = tickNet(), now = Date.now();
        const dt = Math.max(0.2, (now - prevTime) / 1000);
        setS({
          cores: calcUsage(prevCpu, nextCpu), mem: readMem(), temp: readTemp(),
          netRx: Math.max(0, Math.round((nextNet.rx - prevNet.rx) / dt)),
          netTx: Math.max(0, Math.round((nextNet.tx - prevNet.tx) / dt)),
          iface: nextNet.iface, uptime: readUptime(), bat: readBattery(), time: new Date(),
        });
        prevCpu = nextCpu; prevNet = nextNet; prevTime = now;
      } catch { /**/ }
    }, 1000);
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
      <NetMod  rx={s.netRx} tx={s.netTx} iface={s.iface} />
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
