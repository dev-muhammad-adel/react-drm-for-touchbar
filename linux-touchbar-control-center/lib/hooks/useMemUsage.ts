import { useEffect, useState } from 'react';
import { readFileSync } from 'fs';

// Same /proc/meminfo read as app/systembar/page.tsx's readMem, reduced to
// just the percentage a compact widget has room for.

export interface MemInfo { usedGiB: number; totalGiB: number; pct: number; }

function readMem(): MemInfo {
  const txt = readFileSync('/proc/meminfo', 'utf8');
  const kv = (k: string) => parseInt(txt.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'))?.[1] ?? '0');
  const totalKiB = kv('MemTotal');
  const usedKiB = totalKiB - kv('MemAvailable');
  return {
    usedGiB: usedKiB / 1024 / 1024,
    totalGiB: totalKiB / 1024 / 1024,
    pct: totalKiB > 0 ? Math.round((usedKiB / totalKiB) * 100) : 0,
  };
}

const POLL_MS = 3000;

export function useMemUsage(): MemInfo {
  const [mem, setMem] = useState<MemInfo>(() => readMem());

  useEffect(() => {
    const id = setInterval(() => setMem(readMem()), POLL_MS);
    return () => clearInterval(id);
  }, []);

  return mem;
}
