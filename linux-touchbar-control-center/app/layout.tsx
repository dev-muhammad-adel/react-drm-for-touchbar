import React, { useEffect, useState } from 'react';
import { Box, easings, motion } from 'react-drm';
import { ESC_KEY, DOCK, FN_LAYER, CUSTOM_LAYER, THEME } from '@/lib/utils/configLoader';
import { EscKey } from '@/components/EscKey';
import { SafeArea } from '@/components/SafeArea';
import { BootScreen } from '@/components/BootScreen';
import { useBootSequence } from '@/lib/hooks/useBootSequence';
import { usePomodoroEngine } from '@/lib/hooks/usePomodoro';
import { useLayerToggle } from '@/lib/hooks/useLayerToggle';
import { useSystemLockNavigation } from '@/lib/hooks/useSystemLockNavigation';
import type { LayoutChildren } from '@/lib/routes/loadRoutes';
import { TouchIdGate, type TouchIdDeductInfo } from '@/components/TouchIdGate';
import { go } from '@/lib/routes/router-registry';

// No layoutConfig/initial here anymore — app/page.tsx (this segment's own
// sibling page) is root's default automatically, see loadRoutes.ts.

// Overlays toggled by a global hardware shortcut, not by navigating there —
// listed once so each binding's home fallback (below) knows not to flip
// straight into the other one.
const OVERLAYS = ['dock', 'fnkeys', 'custom-layer'];
export default function RootLayout({ width, height, children, current }: {
  width:    number;
  height:   number;
  children: LayoutChildren;
  path:     string; // '' — unused here, root addresses its own siblings by bare name
  current:  string;
}) {
  useLayerToggle(DOCK.shortcut.key, 'dock', {
    mode: DOCK.shortcut.mode, longMs: DOCK.shortcut.longMs, doubleMs: DOCK.shortcut.doubleMs,
    home: 'splitted', overlays: OVERLAYS,
  });
  useLayerToggle('fn', 'fnkeys', {
    mode: FN_LAYER.mode, longMs: FN_LAYER.longMs, doubleMs: FN_LAYER.doubleMs,
    home: 'splitted', overlays: OVERLAYS,
  });
  useLayerToggle(CUSTOM_LAYER.shortcut.key, 'custom-layer', {
    mode: CUSTOM_LAYER.shortcut.mode, longMs: CUSTOM_LAYER.shortcut.longMs, doubleMs: CUSTOM_LAYER.shortcut.doubleMs,
    home: 'splitted', overlays: OVERLAYS,
  });
  const { booted, opacity } = useBootSequence();
  usePomodoroEngine();
  const { isLocked } = useSystemLockNavigation();

  // Width the Touch ID block currently deducts from the layer area (live while
  // animating out/in) — fed by TouchIdGate via onDeduct so children re-lay out
  // mid-animation, not just snap to the final value.
  const [deduct, setDeduct] = useState<TouchIdDeductInfo>({ active: false, blockWidth: 0, liveDeduct: 0 });

  if (!booted) {
    return <BootScreen width={width} height={height} opacity={opacity} />;
  }

  // Wide Touch Bars (no physical Esc key) report a wider panel — show a fixed
  // Esc at the far left and inset the layer area by its width. Only in 'all'
  // mode; 'fn' mode renders Esc inside the Fn-key layer instead.
  const showEsc = width >= ESC_KEY.minWidth && ESC_KEY.onLayers === 'all';

  return (
    <SafeArea width={width} height={height} fontFamily={THEME.fontFamily}>
      {(w, h) => {
        const layerW = showEsc ? w - ESC_KEY.width - ESC_KEY.gap : w;
        const layerHost = (
          <motion.Box
            initial={{ width: layerW - deduct.blockWidth }}
            animate={{ width: layerW -  deduct.blockWidth  }}
            transition={{ duration: [400, 400], ease: easings.easeInBack, delay: deduct.active ? 0 :isLocked?0: 1000 }}
            style={{width:isLocked?layerW:undefined, height: h, overflow: 'hidden' }}
          >
            {children(layerW -(isLocked?0: deduct.liveDeduct), h)}
          </motion.Box>
        );

        const touchId = !isLocked ? <TouchIdGate width={w} height={h} onDeduct={setDeduct} /> : null;

        if (!showEsc) {
          return (
            <Box style={{ width: w, height: h, alignItems: 'stretch' }}>
              {layerHost}
              {touchId}
            </Box>
          );
        }

        return (
          <Box style={{ width: w, height: h, alignItems: 'stretch', gap: ESC_KEY.gap }}>
            <EscKey width={ESC_KEY.width} height={h} />
            {layerHost}
            {touchId}
          </Box>
        );
      }}
    </SafeArea>
  );
}