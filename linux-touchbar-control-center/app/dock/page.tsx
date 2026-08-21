import React, { useState } from 'react';
import { Box, Svg, motion } from 'react-drm';
import { BackButton } from '@/components/BackButton';
import { useActiveWindow } from '@/lib/hooks/useActiveWindow';
import { launchApp } from '@/lib/services/launch';
import { appIconSource } from 'react-drm';
import { DOCK, type DockApp } from '@/lib/utils/configLoader';
import type { LayerConfig } from '@/lib/routes/loadRoutes';

// Resolve every app's theme icon once at module load (app boot) — not on the
// first dock switch, which would block the transition while the icon theme is
// searched. Results are cached, so this is the only filesystem hit.
const ICON_SRC: (string | null)[] = DOCK.apps.map(a => appIconSource(a.iconName ?? a.command));

/** Does the focused window class belong to this dock app? Drives the dot. */
function isRunning(app: DockApp, activeClass: string): boolean {
  if (!app.matchClass?.length) return false;
  const cls = activeClass.toLowerCase();
  return app.matchClass.some(m => cls.includes(m.toLowerCase()));
}

// Low friction → the value overshoots and rings, so the icon bounces up and
// down a couple of times (macOS/Plank launch bounce) instead of a flat lift.
const BOUNCE = { tension: 600, friction: 8 };
// Continuous breathing pulse for running/focused apps — bounces between
// `initial` and `animate` forever via repeat/repeatType, all icons using the
// same duration so they breathe in sync (matches the previous shared-value
// version's look without sharing a value).
const PULSE: import('react-drm').MotionTransition = { duration: 1100, repeat: Infinity, repeatType: 'reverse' };

interface DockIconProps {
  app: DockApp;
  iconSrc: string | null;
  running: boolean;
  slot: number; iconSize: number; lift: number; indicator: typeof DOCK.indicator;
  /** Distance from the button's own bottom edge to the panel's padded content
   *  edge — see indicatorBottom in DockLayer for the derivation. Anchoring the
   *  indicator here (instead of stacking it below the icon in flow) is what
   *  makes it actually track panel.padY instead of getting shaved off by the
   *  padding clip along with everything else past the button's oversized
   *  (slot > display height) touch-target box. */
  indicatorBottom: number;
}

/** One dock slot. Every effect here is its own motion.Box `animate` target
 *  keyed off `pressed`/`running` — no shared spring, no .to() derivation. */
function DockIcon({ app, iconSrc, running, slot, iconSize, lift, indicator, indicatorBottom }: DockIconProps) {
  const [pressed, setPressed] = useState(false);

  const glowSize = pressed ? slot : Math.round(0.55 * slot);
  const pillW = pressed ? indicator.size + 12 : indicator.size;
  const pillColor = pressed ? 'rgba(125, 211, 252, 0.9)' : 'rgba(125, 211, 252, 0)';

  return (
    <Box style={{width: slot, alignItems: 'center', justifyContent: 'center' }}>
      <motion.Button
        width={slot} height={slot}
        style={{ flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 14, overflow: 'hidden' }}
        // initial={{ color: '#373737' }}
        onActiveChange={setPressed}
        onClick={() => launchApp(app)}
      >
        {/* Running app: soft halo that breathes behind the icon */}
        {running && (
          <motion.Box
            style={{ position: 'absolute' }}
            initial={{ height: Math.round(0.7 * slot), top: Math.round((slot - 0.7 * slot) / 2), borderRadius: Math.round(0.7 * slot / 2) }}
            animate={{ height: Math.round(0.95 * slot), top: Math.round((slot - 0.95 * slot) / 2), borderRadius: Math.round(0.95 * slot / 2) }}
            transition={PULSE}
          />
        )}

        {/* Glow that springs open behind the icon on press — capped to the slot */}
        <motion.Box
          style={{ position: 'absolute' }}
          animate={{ height: glowSize, top: Math.round((slot - glowSize) / 2), borderRadius: Math.round(glowSize / 2) }}
          transition={BOUNCE}
        />

        {/* Icon bounces: the ringing spring carries it above/below rest on press */}
        <motion.Box
          style={{ position: 'relative', width: iconSize, height: iconSize, alignItems: 'center', justifyContent: 'center' }}
          animate={{ top: pressed ? -lift : 0 }}
          transition={BOUNCE}
        >
          {iconSrc
            ? <Svg src={iconSrc} width={iconSize} height={iconSize} style={{ width: iconSize, height: iconSize }} />
            : <app.icon size={iconSize} color={app.color} />}
        </motion.Box>

        {/* Focused-app dot; widens into a bright pill while pressed (also the
            press feedback when the app isn't focused). Running apps instead
            pulse their own color continuously, independent of press.
            Positioned absolute (not stacked below the icon in flow) and
            anchored off indicatorBottom, so it tracks panel.padY directly
            instead of riding along with the button's oversized flow column —
            see indicatorBottom's derivation in DockLayer. `left` is computed
            in JS (not centered via alignItems, which this engine doesn't
            apply to absolute children) to keep the pill centered as pillW
            springs between its resting and pressed width. */}
        {running ? (
          <motion.Box
            style={{ position: 'absolute', bottom: indicatorBottom, borderRadius: indicator.size / 2 }}
            initial={{ width: pillW, height: indicator.size, left: Math.round((slot - pillW) / 2), color: 'rgba(125, 211, 252, 0.55)' }}
            animate={{ width: pillW, height: indicator.size, left: Math.round((slot - pillW) / 2), color: 'rgba(125, 211, 252, 1)' }}
            transition={PULSE}
          />
        ) : (
          <motion.Box
            style={{ position: 'absolute', bottom: indicatorBottom, height: indicator.size, borderRadius: indicator.size / 2 }}
            animate={{ width: pillW, left: Math.round((slot - pillW) / 2), color: pillColor }}
            transition={BOUNCE}
          />
        )}
      </motion.Button>
    </Box>
  );
}

export const layerConfig: LayerConfig = {
  leaving:  { outAnim: 'slide-down' },
  entering: { inAnim:  'slide-up' },
};

/**
 * Plank-style app dock: a translucent rounded panel of icons centered on the
 * bar. Tapping launches the app (see services/launch.ts); the pressed icon
 * lifts with a spring (Plank's hover-zoom, adapted to touch) and a dot marks
 * the app matching the currently focused window.
 */
export default function DockLayer({ width, height }: { width: number; height: number }) {
  const { class: activeClass } = useActiveWindow();
  const { apps, gap, panel, indicator, iconSize, lift, slot } = DOCK;

  // The button's own box is `slot` tall (bigger than `height` on purpose —
  // a roomier touch target than the physical display), floating centered
  // over the display and so overhanging both edges by (slot-height)/2. The
  // panel's clip band sits `padY` in from the display's true edges. To keep
  // the indicator's distance from the button's bottom edge landing exactly
  // `padY` above the *panel's* visible bottom edge (not the button's own,
  // which is off past the display), that overhang has to be added back in.
  const indicatorBottom = (slot - height) / 2 + panel.padY;

  return (
    <Box style={{ width, height, justifyContent: 'center', alignItems: 'center' }}>
      {/* Back to the main split layer — kept off-center so the dock stays centered. */}
      <Box style={{ position: 'absolute', left: 6, top: 0 , height, alignItems: 'center' }}>
        <BackButton to="splitted" animation="slide-down" />
      </Box>

      {/* Translucent panel: locked to the full display height so it never
          overflows regardless of icon size. overflow:hidden clips to the
          padding-inset content box, so paddingVertical/padX are real clip
          boundaries — an oversized icon is cut at the padded edge, not the
          panel's own outer edge. */}
      <Box style={{
        height,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap,
        paddingHorizontal: panel.padX,
        paddingVertical: panel.padY,
        backgroundColor: panel.color,
        borderRadius: panel.radius,
        overflow: 'hidden',
      }}>
        {apps.map((app, i) => (
          <DockIcon
            key={app.id}
            app={app}
            iconSrc={ICON_SRC[i]}
            running={isRunning(app, activeClass)}
            slot={slot} iconSize={iconSize} lift={lift} indicator={indicator}
            indicatorBottom={indicatorBottom}
          />
        ))}
      </Box>
    </Box>
  );
}
