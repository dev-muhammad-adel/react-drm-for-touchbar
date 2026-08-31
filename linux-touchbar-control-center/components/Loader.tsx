import React, { useState, useEffect } from 'react';
import { Box, Gif, Svg, Text } from 'react-drm';
import { useAnimate, ease } from '@/lib/hooks/useAnimate';
import { readFileSync } from 'fs';

interface LoaderProps {
  width?: number;
  height?: number;
}

const DURATION = 2000;
const FROM     = 685;
const TO       = -685;

export function Loader({ width = 120, height = 60 }: LoaderProps) {
  const [offset, setOffset] = useState(FROM);
  const opacity = useAnimate(1, 400, ease.out); // fade in on mount

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const t = ((Date.now() - start) % DURATION) / DURATION;
      setOffset(FROM + t * (TO - FROM));
    }, 33);
    return () => clearInterval(id);
  }, []);

  const src = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150"><path fill="none" stroke="#cccccc" stroke-width="6" stroke-linecap="round" stroke-dasharray="300 385" stroke-dashoffset="${offset}" d="M275 75c0 31-27 50-50 50-58 0-92-100-150-100-28 0-50 22-50 50s23 50 50 50c58 0 92-100 150-100 24 0 50 19 50 50Z"/></svg>`;
function loadLogo(): string | null {
  const file = 'public/logo.png';
  const data = readFileSync(file).toString('base64');
  return '<svg xmlns="http://www.w3.org/2000/svg" ' +
    `viewBox="0 0 ${300} ${40}">` +
    `<image width="${300}" height="${40}" ` +
    `href="data:image/png;base64,${data}"/></svg>`;
}
const LOGO = loadLogo();

  return (
  
      <Box width={300} height={40} style={{
        // backgroundColor:"red"
      }}>
        <Svg src={LOGO??''} width={300} height={40} />
      </Box >

  );
}
