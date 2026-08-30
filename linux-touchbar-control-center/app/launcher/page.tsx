import React from 'react';
import { Box } from 'react-drm';
import { BackButton } from '@/components/BackButton';
import { TouchBarLauncher } from '@/components/launcher/TouchBarLauncher';
import type { LayerConfig } from '@/lib/routes/loadRoutes';

export const layerConfig: LayerConfig = {
  leaving:  { outAnim: 'slide-down' },
  entering: { inAnim:  'slide-up' },
};

const BACK_W   = 64;  // reserved gutter for the back button
const GUTTER   = 14;  // breathing room between the back button and the launcher row
const EDGE     = 6;   // inset of the back button from the bar's left edge

/**
 * The system app launcher layer: every installed application as a horizontal,
 * alphabet-scrollable row, with a swipe-to-A–Z navigator. The back button lives
 * in its own reserved slot (fully outside the launcher field's touch surface),
 * which owns all input starting at `offsetX`.
 */
export default function Launcher({ width, height }: { width: number; height: number }) {
  const launcherLeft = EDGE + BACK_W + GUTTER;
  const launcherWidth = Math.max(0, width - launcherLeft);

  return (
    <Box style={{ width, height, flexDirection: 'row', alignItems: 'center' }}>
      <Box style={{
        position: 'absolute', left: EDGE, top: 0, width: BACK_W, height,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <BackButton to="splitted" animation="slide-down" />
      </Box>

      <Box style={{ position: 'absolute', left: launcherLeft, top: 0, width: launcherWidth, height }}>
        <TouchBarLauncher width={launcherWidth} height={height} offsetX={launcherLeft} />
      </Box>
    </Box>
  );
}