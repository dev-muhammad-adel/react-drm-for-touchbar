/**
 * System Monitor — Touch Bar (2008 × 60)
 *
 * Sections: CPU cores | RAM | Temp | Network | Battery
 * Updates every second.
 *
 */

import React, { useState, useEffect } from 'react';
import { render, Box, Text, DrmDisplay } from 'react-drm';
import fs from 'fs';

// ── System readers ────────────────────────────────────────────────────────────

interface CpuTick { total: number; idle: number; }

function tickCpu(): CpuTick[] {
  return fs.readFileSync('/proc/stat', 'utf8')
    .split('\n')
    .filter((l: string) => /^cpu\d/.test(l))
    .map((l: string) => {
      const n = l.split(/\s+/).slice(1).map(Number);
      return { total: n.reduce((s: number, v: number) => s + v, 0), idle: n[3] + (n[4] ?? 0) };
    });
}

function calcUsage(a: CpuTick[], b: CpuTick[]): number[] {
  return b.map((t, i) => {
    const dt = t.total - a[i].total;
    const di = t.idle  - a[i].idle;
    return dt > 0 ? Math.max(0, Math.min(100, Math.round(100 * (1 - di / dt)))) : 0;
  });
}

function readMem(): { used: number; total: number } {
  const txt = fs.readFileSync('/proc/meminfo', 'utf8');
  const kv = (k: string) => parseInt(txt.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'))?.[1] ?? '0');
  const total = kv('MemTotal') * 1024;
  const avail = kv('MemAvailable') * 1024;
  return { used: total - avail, total };
}

function readTemp(): number | null {
  // Prefer package temperature from coretemp, k10temp, or zenpower
  try {
    for (const d of fs.readdirSync('/sys/class/hwmon')) {
      try {
        const name = fs.readFileSync(`/sys/class/hwmon/${d}/name`, 'utf8').trim();
        if (/coretemp|k10temp|zenpower/.test(name)) {
          // temp1 = package temperature (highest-level reading)
          const v = parseInt(fs.readFileSync(`/sys/class/hwmon/${d}/temp1_input`, 'utf8').trim());
          return Math.round(v / 1000);
        }
      } catch { /* next */ }
    }
  } catch { /* fall through */ }
  // Fallback: first thermal zone with a reasonable value
  for (let i = 0; i < 10; i++) {
    try {
      const v = parseInt(fs.readFileSync(`/sys/class/thermal/thermal_zone${i}/temp`, 'utf8').trim());
      const c = Math.round(v / 1000);
      if (c >= 20 && c <= 110) return c;
    } catch { /* next */ }
  }
  return null;
}

interface NetTick { iface: string; rx: number; tx: number; }

// Prefer wlan0 / eth0 / enp* / wlp* — skip loopback and VPN-like interfaces
const IFACE_SKIP = /^(lo|CloudflareWARP|t2_ncm|docker|veth|br-|virbr)/;

function tickNet(): NetTick {
  const lines = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2);
  let best: NetTick | null = null;
  for (const line of lines) {
    const p = line.trim().split(/\s+/);
    const iface = p[0].replace(':', '');
    if (!iface || IFACE_SKIP.test(iface)) continue;
    const tick = { iface, rx: parseInt(p[1]), tx: parseInt(p[9]) };
    // Prefer the interface with the most total traffic
    if (!best || tick.rx + tick.tx > best.rx + best.tx) best = tick;
  }
  return best ?? { iface: '?', rx: 0, tx: 0 };
}

function readBat(): { pct: number; charging: boolean } | null {
  for (const p of ['/sys/class/power_supply/BAT0', '/sys/class/power_supply/BAT1']) {
    try {
      return {
        pct:      parseInt(fs.readFileSync(`${p}/capacity`, 'utf8').trim()),
        charging: fs.readFileSync(`${p}/status`, 'utf8').trim() === 'Charging',
      };
    } catch { /* next */ }
  }
  return null;
}

// ── Layout ────────────────────────────────────────────────────────────────────

const NUM_CORES  = tickCpu().length;
const INIT_BAT   = readBat();
const HAS_BAT    = INIT_BAT !== null;

const SEP_W = 2;
const SECS  = HAS_BAT ? 5 : 4;
const AVAIL = 2008 - (SECS - 1) * SEP_W;

// Proportional weights: CPU gets more room to show per-core bars
const WEIGHTS = HAS_BAT ? [30, 22, 12, 20, 16] : [35, 25, 13, 27];
const WIDTHS  = WEIGHTS.map(w => Math.floor(AVAIL * w / 100));
// Give leftover pixels to last section to fill exactly 2008
WIDTHS[WIDTHS.length - 1] += 2008 - WIDTHS.reduce((s, v) => s + v, 0) - (SECS - 1) * SEP_W;

const [CPU_W, MEM_W, TEMP_W, NET_W, BAT_W = 0] = WIDTHS;

const MEM_X  = CPU_W + SEP_W;
const TEMP_X = MEM_X + MEM_W + SEP_W;
const NET_X  = TEMP_X + TEMP_W + SEP_W;
const BAT_X  = NET_X + NET_W + SEP_W;

// ── Style constants ───────────────────────────────────────────────────────────

const BG          = '#0d1117';
const LABEL_COLOR = '#475569';
const LABEL_SZ    = 11;
const LABEL_Y     = 3;
const BAR_TOP     = 15;
const BAR_BOT     = 58;
const BAR_H       = BAR_BOT - BAR_TOP; // 43

function loadColor(pct: number): string {
  if (pct < 50) return '#22c55e';
  if (pct < 80) return '#eab308';
  return '#ef4444';
}
function tempColor(c: number): string {
  if (c < 65) return '#22c55e';
  if (c < 82) return '#f59e0b';
  return '#ef4444';
}
function batColor(pct: number): string {
  if (pct > 40) return '#22c55e';
  if (pct > 15) return '#f59e0b';
  return '#ef4444';
}

function fmtRate(bps: number): string {
  if (bps >= 1e9) return (bps / 1e9).toFixed(1) + ' GB/s';
  if (bps >= 1e6) return (bps / 1e6).toFixed(1) + ' MB/s';
  if (bps >= 1e3) return (bps / 1e3).toFixed(0) + ' KB/s';
  return bps + ' B/s';
}
function fmtGiB(bytes: number): string {
  return (bytes / (1024 ** 3)).toFixed(1) + 'G';
}

// ── Section components ────────────────────────────────────────────────────────

function Sep({ x }: { x: number }) {
  return <Box x={x} y={8} width={SEP_W} height={44} color="#1e293b" />;
}

function CpuSection({ x, cores }: { x: number; cores: number[] }) {
  const avg = Math.round(cores.reduce((s, v) => s + v, 0) / cores.length);
  const pctW  = 86;
  const pad   = 8;
  const areaW = CPU_W - pad - pctW;
  const gap   = Math.min(3, Math.floor(areaW / cores.length / 10));
  const barW  = Math.floor((areaW - (cores.length - 1) * gap) / cores.length);

  return (
    <Box x={x} y={0} width={CPU_W} height={60} color={BG}>
      <Text x={pad} y={LABEL_Y} color={LABEL_COLOR} fontSize={LABEL_SZ} fontFamily="monospace">
        {`CPU ×${cores.length}`}
      </Text>

      {/* Per-core vertical bars */}
      {cores.map((usage, i) => {
        const bx     = pad + i * (barW + gap);
        const fillH  = Math.max(1, Math.round(BAR_H * usage / 100));
        const emptyH = BAR_H - fillH;
        const color  = loadColor(usage);
        const showPct = fillH >= 14 && barW >= 24;
        const pctStr  = `${usage}%`;
        const pctX    = bx + Math.max(1, Math.floor((barW - pctStr.length * 6) / 2));
        return (
          <React.Fragment key={i}>
            {emptyH > 0 && (
              <Box x={bx} y={BAR_TOP} width={barW} height={emptyH} color="#111820" />
            )}
            <Box x={bx} y={BAR_TOP + emptyH} width={barW} height={fillH} color={color} />
            {showPct && (
              <Text x={pctX} y={BAR_BOT - 12} color="#0a0a0a" fontSize={10} fontFamily="monospace">
                {pctStr}
              </Text>
            )}
          </React.Fragment>
        );
      })}

      {/* Overall % (large, right-aligned) */}
      <Text x={CPU_W - pctW + 4} y={18} color={loadColor(avg)} fontSize={24} fontFamily="monospace">
        {`${avg}%`}
      </Text>
    </Box>
  );
}

function MemSection({ x, used, total }: { x: number; used: number; total: number }) {
  const pct   = total > 0 ? used / total : 0;
  const pad   = 10;
  const barW  = MEM_W - pad * 2;
  const fillW = Math.round(barW * pct);
  const pctN  = Math.round(pct * 100);

  return (
    <Box x={x} y={0} width={MEM_W} height={60} color={BG}>
      <Text x={pad} y={LABEL_Y} color={LABEL_COLOR} fontSize={LABEL_SZ} fontFamily="monospace">MEM</Text>

      <Box x={pad} y={BAR_TOP} width={barW} height={BAR_H} color="#111820" />
      {fillW > 0 && (
        <Box x={pad} y={BAR_TOP} width={fillW} height={BAR_H} color={loadColor(pctN)} />
      )}
      {[1, 2, 3].map(q => (
        <Box key={q} x={pad + Math.round(barW * q / 4)} y={BAR_TOP} width={1} height={BAR_H} color="#0d1117" />
      ))}

      <Text x={pad} y={BAR_BOT - 11} color="#94a3b8" fontSize={11} fontFamily="monospace">
        {`${fmtGiB(used)} / ${fmtGiB(total)}`}
      </Text>
      <Text x={MEM_W - pad - 36} y={BAR_BOT - 11} color={loadColor(pctN)} fontSize={11} fontFamily="monospace">
        {`${pctN}%`}
      </Text>
    </Box>
  );
}

function TempSection({ x, temp }: { x: number; temp: number | null }) {
  const pad   = 12;
  const color = temp !== null ? tempColor(temp) : '#475569';
  const label = temp !== null ? `${temp}°` : 'N/A';
  const sub   = temp !== null ? 'C' : '';

  const barX  = TEMP_W - pad - 14;
  const fillH = temp !== null ? Math.round(BAR_H * Math.max(0, Math.min(1, (temp - 20) / 90))) : 0;

  return (
    <Box x={x} y={0} width={TEMP_W} height={60} color={BG}>
      <Text x={pad} y={LABEL_Y} color={LABEL_COLOR} fontSize={LABEL_SZ} fontFamily="monospace">TEMP</Text>
      <Text x={pad} y={16} color={color} fontSize={28} fontFamily="monospace">{label}</Text>
      <Text x={pad + label.length * 17} y={24} color={color} fontSize={14} fontFamily="monospace">{sub}</Text>
      <Box x={barX} y={BAR_TOP} width={10} height={BAR_H} color="#111820" />
      {fillH > 0 && (
        <Box x={barX} y={BAR_BOT - fillH} width={10} height={fillH} color={color} />
      )}
    </Box>
  );
}

function NetSection({ x, rx, tx, iface }: { x: number; rx: number; tx: number; iface: string }) {
  const pad = 10;

  return (
    <Box x={x} y={0} width={NET_W} height={60} color={BG}>
      <Text x={pad} y={LABEL_Y} color={LABEL_COLOR} fontSize={LABEL_SZ} fontFamily="monospace">
        {`NET  ${iface}`}
      </Text>
      <Text x={pad} y={15} color="#64748b" fontSize={11} fontFamily="monospace">{'↓'}</Text>
      <Text x={pad + 14} y={15} color="#38bdf8" fontSize={15} fontFamily="monospace">{fmtRate(rx)}</Text>
      <Text x={pad} y={37} color="#64748b" fontSize={11} fontFamily="monospace">{'↑'}</Text>
      <Text x={pad + 14} y={37} color="#fb923c" fontSize={15} fontFamily="monospace">{fmtRate(tx)}</Text>
    </Box>
  );
}

function BatSection({ x, bat }: { x: number; bat: { pct: number; charging: boolean } | null }) {
  if (!bat) return null;
  const pad   = 10;
  const barW  = BAT_W - pad * 2;
  const fillW = Math.round(barW * bat.pct / 100);
  const color = batColor(bat.pct);

  return (
    <Box x={x} y={0} width={BAT_W} height={60} color={BG}>
      <Text x={pad} y={LABEL_Y} color={LABEL_COLOR} fontSize={LABEL_SZ} fontFamily="monospace">
        {bat.charging ? 'BAT  charging' : 'BAT'}
      </Text>
      <Box x={pad} y={BAR_TOP} width={barW} height={BAR_H} color="#111820" />
      {fillW > 0 && (
        <Box x={pad} y={BAR_TOP} width={fillW} height={BAR_H} color={color} />
      )}
      <Box x={pad + barW} y={BAR_TOP + 14} width={4} height={15} color="#1e293b" />
      <Text x={pad} y={BAR_BOT - 11} color={color} fontSize={13} fontFamily="monospace">
        {`${bat.pct}%  ${bat.charging ? '▲' : '▼'}`}
      </Text>
    </Box>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface State {
  cores:  number[];
  mem:    { used: number; total: number };
  temp:   number | null;
  netRx:  number;
  netTx:  number;
  iface:  string;
  bat:    { pct: number; charging: boolean } | null;
}

function SysMonitor({ width, height }: { width: number; height: number }) {
  const [s, setS] = useState<State>({
    cores: new Array(NUM_CORES).fill(0),
    mem:   readMem(),
    temp:  readTemp(),
    netRx: 0, netTx: 0, iface: '',
    bat:   INIT_BAT,
  });

  useEffect(() => {
    let prevCpu  = tickCpu();
    let prevNet  = tickNet();
    let prevTime = Date.now();

    const id = setInterval(() => {
      try {
        const nextCpu  = tickCpu();
        const nextNet  = tickNet();
        const now      = Date.now();
        const dt       = Math.max(0.2, (now - prevTime) / 1000);

        setS({
          cores:  calcUsage(prevCpu, nextCpu),
          mem:    readMem(),
          temp:   readTemp(),
          netRx:  Math.max(0, Math.round((nextNet.rx - prevNet.rx) / dt)),
          netTx:  Math.max(0, Math.round((nextNet.tx - prevNet.tx) / dt)),
          iface:  nextNet.iface,
          bat:    readBat(),
        });

        prevCpu  = nextCpu;
        prevNet  = nextNet;
        prevTime = now;
      } catch (e) { /* ignore transient read errors */ }
    }, 1000);

    return () => clearInterval(id);
  }, []);

  return (
    <Box x={0} y={0} width={width} height={height} color={BG}>
      <CpuSection x={0}      cores={s.cores} />
      <Sep        x={CPU_W} />
      <MemSection x={MEM_X}  used={s.mem.used} total={s.mem.total} />
      <Sep        x={TEMP_X - SEP_W} />
      <TempSection x={TEMP_X} temp={s.temp} />
      <Sep        x={NET_X - SEP_W} />
      <NetSection x={NET_X}  rx={s.netRx} tx={s.netTx} iface={s.iface} />
      {HAS_BAT && <Sep x={BAT_X - SEP_W} />}
      {HAS_BAT && <BatSection x={BAT_X} bat={s.bat} />}
    </Box>
  );
}

