import React from 'react';
import { readFileSync } from 'fs';
import path from 'path';
import { Box, Svg } from 'react-drm';

interface BootScreenProps {
  width: number;
  height: number;
  opacity: number;
}

const LOGO_WIDTH = 883;
const LOGO_HEIGHT = 235;

function loadLogo(): string {
  const file = path.join(process.cwd(), 'public', 'kait2en-wordmark.png');
  const data = readFileSync(file).toString('base64');

  return '<svg xmlns="http://www.w3.org/2000/svg" ' +
    `viewBox="0 0 ${LOGO_WIDTH} ${LOGO_HEIGHT}">` +
    `<image width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" ` +
    `href="data:image/png;base64,${data}"/></svg>`;
}

const LOGO = loadLogo();

export function BootScreen({ width, height, opacity }: BootScreenProps) {
  const logoHeight = Math.min(38, Math.round(height * 0.64));
  const logoWidth = Math.round(logoHeight * LOGO_WIDTH / LOGO_HEIGHT);

  return (
    <Box
      width={width}
      height={height}
      style={{
        width,
        height,
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#000000',
        overflow: 'hidden',
      }}
    >
      <Svg src={LOGO} width={logoWidth} height={logoHeight} />
      <Box
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width,
          height,
          backgroundColor: `rgba(0,0,0,${(1 - opacity).toFixed(3)})`,
        }}
      />
    </Box>
  );
}
