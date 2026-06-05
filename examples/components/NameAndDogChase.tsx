import React, { useState, useEffect } from 'react';
import { Box, Svg } from 'react-drm';

export function NameAndDogChase({
  left,
  right,
  top,
}: {
  left: number;
  right: number;
  top: number;
  bottom: number;
}) {
  const trackY = top + 6;
  const girlW = 84, girlH = 40;
  const dogW  = 84, dogH  = 38;
  const minX  = left + 8;
  const maxX  = right - girlW - 8;

  const [motion, setMotion] = useState({
    girlX: left + 280,
    dogX: left + 130,
    dir: 1,
    phase: 0,
  });

  const girlFrontLegY = motion.phase === 0 ? 29 : 25;
  const girlBackLegY  = motion.phase === 0 ? 25 : 29;
  const GIRL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="84" height="40" viewBox="0 0 84 40">
    <text x="42" y="10" text-anchor="middle" font-family="monospace" font-size="12" font-weight="700" fill="#22d3ee">reem</text>
    <circle cx="44" cy="14" r="5" fill="#fde68a"/>
    <rect x="40" y="19" width="9" height="10" rx="4" fill="#f472b6"/>
    <rect x="31" y="20" width="8" height="3" rx="1" fill="#fde68a"/>
    <rect x="49" y="20" width="8" height="3" rx="1" fill="#fde68a"/>
    <rect x="40" y="${girlFrontLegY}" width="4" height="8" rx="2" fill="#fb7185"/>
    <rect x="46" y="${girlBackLegY}" width="4" height="8" rx="2" fill="#fb7185"/>
  </svg>`;

  const dogFrontLegY = motion.phase === 0 ? 25 : 22;
  const dogBackLegY  = motion.phase === 0 ? 22 : 25;
  const DOG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="84" height="38" viewBox="0 0 84 38">
    <rect x="0" y="34" width="84" height="4" fill="#1f2937"/>
    <ellipse cx="40" cy="20" rx="20" ry="11" fill="#c08457"/>
    <circle cx="62" cy="16" r="8" fill="#c08457"/>
    <circle cx="65" cy="14" r="1.2" fill="#0f172a"/>
    <polygon points="68,10 74,6 71,13" fill="#a1623b"/>
    <path d="M18 17 Q11 11 8 16" stroke="#a1623b" stroke-width="3" fill="none" stroke-linecap="round"/>
    <rect x="28" y="${dogFrontLegY}" width="5" height="10" rx="2" fill="#a1623b"/>
    <rect x="47" y="${dogBackLegY}" width="5" height="10" rx="2" fill="#a1623b"/>
  </svg>`;

  useEffect(() => {
    const id = setInterval(() => {
      setMotion(prev => {
        let dir = prev.dir;
        let nextGirlX = prev.girlX + dir * 8;

        if (nextGirlX <= minX) { nextGirlX = minX; dir =  1; }
        else if (nextGirlX >= maxX) { nextGirlX = maxX; dir = -1; }

        const targetDogX = dir > 0 ? nextGirlX - 122 : nextGirlX + 122;
        const step = Math.max(-9, Math.min(9, targetDogX - prev.dogX));
        const nextDogX = Math.max(minX, Math.min(right - dogW - 8, prev.dogX + step));

        return { girlX: nextGirlX, dogX: nextDogX, dir, phase: (prev.phase + 1) % 2 };
      });
    }, 70);
    return () => clearInterval(id);
  }, [left, right, minX, maxX]);

  const girlY = trackY + (motion.phase === 0 ? 0 : 1);
  const dogY  = trackY + 2 + (motion.phase === 0 ? 1 : 0);

  return (
    <>
      <Box x={left} y={trackY + dogH + 1} width={right - left} height={2} color="#243447" />
      <Svg x={motion.dogX}  y={dogY}  width={dogW}  height={dogH}  src={DOG_SVG} />
      <Svg x={motion.girlX} y={girlY} width={girlW} height={girlH} src={GIRL_SVG} />
    </>
  );
}
