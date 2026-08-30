import React from 'react';
import { readFileSync, existsSync } from 'fs';
import { Box, Svg } from 'react-drm';
import { Loader } from './Loader';

interface BootScreenProps {
  width: number;
  height: number;
  opacity: number;
}

// Optional boot logo, driven by REACT_DRM_BOOT_LOGO (set per-distro in the
// repo .env — e.g. a fork's wordmark). Falls back to the plain spinner when
// the env var is unset or the file is missing, so upstream t2linux builds
// keep the original look with no extra dependency.
const LOGO_WIDTH = 883;
const LOGO_HEIGHT = 235;

function loadLogo(): string | null {
  const file = process.env.REACT_DRM_BOOT_LOGO;
  if (!file || !existsSync(file)) return null;
  const data = readFileSync(file).toString('base64');
  return '<svg xmlns="http://www.w3.org/2000/svg" ' +
    `viewBox="0 0 ${LOGO_WIDTH} ${LOGO_HEIGHT}">` +
    `<image width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" ` +
    `href="data:image/png;base64,${data}"/></svg>`;
}

const LOGO = loadLogo();

export function BootScreen({ width, height, opacity }: BootScreenProps) {
  if (LOGO) {
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

  return (
    <Box width={width} height={height} style={{ alignItems: 'center', justifyContent: 'center', opacity }}>
      <Loader width={120} height={height} />
    </Box>
  );
}