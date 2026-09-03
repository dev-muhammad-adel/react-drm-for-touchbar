import { useState, useEffect } from 'react';

const FADE_IN  = 700;
const HOLD     = 1000;
const FADE_OUT = 700;
const TOTAL    = FADE_IN + HOLD + FADE_OUT;

export function useBootSequence(): { booted: boolean; opacity: number } {
  const [booted,  setBooted]  = useState(false);
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const e = Date.now() - start;
      if (e >= TOTAL) { setBooted(true); clearInterval(id); return; }
      setOpacity(
        e < FADE_IN          ? e / FADE_IN :
        e < FADE_IN + HOLD   ? 1 :
                               1 - (e - FADE_IN - HOLD) / FADE_OUT,
      );
    }, 16);
    return () => clearInterval(id);
  }, []);

  return { booted, opacity };
}
