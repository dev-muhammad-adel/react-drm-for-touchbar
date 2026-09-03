import { useEffect, useState } from 'react';
import { readFileSync } from 'fs';

// Same /proc/stat delta-sampling approach as app/systembar/page.tsx's
// tickCpu/calcUsage, collapsed to one overall percentage (systembar shows
// per-core; a bar widget this small only has room for one number).

interface CpuTick { total: number; idle: number; }

function tickCpu(): CpuTick {
  const lines = readFileSync('/proc/stat', 'utf8').split('\n').filter(l => /^cpu\s/.test(l));
  const n = lines[0].split(/\s+/).slice(1).map(Number);
  return { total: n.reduce((s, v) => s + v, 0), idle: n[3] + (n[4] ?? 0) };
}

const POLL_MS = 2000;

/** Overall CPU usage 0-100, or null until the second sample lands. */
export function useCpuUsage(): number | null {
  const [pct, setPct] = useState<number | null>(null);

  useEffect(() => {
    let prev = tickCpu();
    const id = setInterval(() => {
      const cur = tickCpu();
      const dt = cur.total - prev.total, di = cur.idle - prev.idle;
      prev = cur;
      setPct(dt > 0 ? Math.max(0, Math.min(100, Math.round(100 * (1 - di / dt)))) : 0);
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  return pct;
}
