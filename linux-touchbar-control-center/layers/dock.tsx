import React, { useEffect } from 'react';
import { Box, Button, Svg, animated, useSprings, useSpringValue } from 'react-drm';
import { BackButton } from '../components/BackButton';
import { useActiveWindow } from '../hooks/useActiveWindow';
import { launchApp } from '../services/launch';
import { appIconSource } from '../services/appIcon';
import { DOCK, type DockApp } from '../config';

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

/**
 * Plank-style app dock: a translucent rounded panel of icons centered on the
 * bar. Tapping launches the app (see services/launch.ts); the pressed icon
 * lifts with a spring (Plank's hover-zoom, adapted to touch) and a dot marks
 * the app matching the currently focused window.
 */
export function DockLayer({ width, height }: { width: number; height: number }) {
  const { class: activeClass } = useActiveWindow();
  const { apps, slot, iconSize, gap, lift, panel, indicator } = DOCK;

  // Low friction → the value overshoots and rings, so the icon bounces up and
  // down a couple of times (macOS/Plank launch bounce) instead of a flat lift.
  const [springs, api] = useSprings(apps.length, () => ({
    p: 0,
    config: { tension: 600, friction: 8 },
  }));

  const press   = (i: number) => api.start(idx => (idx === i ? { p: 1 } : null));
  const release = (i: number) => api.start(idx => (idx === i ? { p: 0 } : null));

  // Continuous breathing pulse for running/focused apps (0 → 1 → 0 forever).
  const pulse = useSpringValue(0);
  useEffect(() => {
    pulse.start({ from: 0, to: 1, loop: { reverse: true }, config: { duration: 1100 } });
  }, [pulse]);

  return (
    <Box style={{ width, height, justifyContent: 'center', alignItems: 'center' }}>
      {/* Back to the main split layer — kept off-center so the dock stays centered. */}
      <Box style={{ position: 'absolute', left: 6, top: 0 , height, alignItems: 'center' }}>
        <BackButton to="splitted" animation="slide-down" />
      </Box>

      <Box style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap,
        // paddingHorizontal: panel.padX,
        // paddingVertical: panel.padY,
        // backgroundColor: panel.color,
        borderRadius: panel.radius,
      }}>
        {apps.map((app, i) => {
          const Icon    = app.icon;
          const running = isRunning(app, activeClass);
          const sp      = springs[i].p;
          const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
          // No vertical headroom on the bar, so the magnification is horizontal:
          // the slot widens and pushes its neighbours apart (Plank/macOS-dock
          // style). The glow disc is capped to the slot, so it never spills
          // past the bar edges.
          const glow    = (v: number) => Math.round((0.55 + 0.45 * clamp01(v)) * slot);
          const SPREAD  = 0; // px the slot grows on press

          return (
            <animated.Box
              key={app.id}
              style={{
                width:  sp.to(v => Math.round(slot + SPREAD * clamp01(v))),
                height: slot,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Button
                width={slot} height={slot}
                color="transparent" activeColor="transparent"
                style={{ flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 14 }}
                onTouchStart={() => press(i)}
                onTouchEnd={() => release(i)}
                onTouchCancel={() => release(i)}
                onClick={() => launchApp(app)}
              >
                {/* Running app: soft halo that breathes behind the icon */}
                {running && (
                  <animated.Box style={{
                    position: 'absolute',
                    // width:        pulse.to(v => Math.round((0.7 + 0.25 * v) * slot)),
                    height:       pulse.to(v => Math.round((0.7 + 0.25 * v) * slot)),
                    // left:         pulse.to(v => Math.round((slot - (0.7 + 0.25 * v) * slot) / 2)),
                    top:          pulse.to(v => Math.round((slot - (0.7 + 0.25 * v) * slot) / 2)),
                    borderRadius: pulse.to(v => Math.round((0.7 + 0.25 * v) * slot / 2)),
                    // backgroundColor: pulse.to(v => `rgba(125, 211, 252, ${(0.07 + 0.10 * v).toFixed(3)})`),
                  }} />
                )}

                {/* Glow that springs open behind the icon — capped to the slot */}
                <animated.Box style={{
                  position: 'absolute',
                  // width:        sp.to(v => glow(v)),
                  height:       sp.to(v => glow(v)),
                  // left:         sp.to(v => Math.round((slot - glow(v)) / 2)),
                  top:          sp.to(v => Math.round((slot - glow(v)) / 2)),
                  borderRadius: sp.to(v => Math.round(glow(v) / 2)),
                  // backgroundColor: sp.to(v => `rgba(125, 211, 252, ${(0.22 * clamp01(v)).toFixed(3)})`),
                }} />

                {/* Icon bounces: the ringing spring carries top above/below 0 */}
                <animated.Box style={{
                  position: 'relative',
                  top: sp.to(v => Math.round(-lift * v)),
                  width: iconSize,
                  height: iconSize,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {ICON_SRC[i]
                    ? <Svg src={ICON_SRC[i]!} width={iconSize} height={iconSize} style={{ width: iconSize, height: iconSize }} />
                    : <Icon size={iconSize} color={app.color} />}
                </animated.Box>

                {/* Focused-app dot; widens into a bright pill while pressed
                    (also the press feedback when the app isn't focused). */}
                <animated.Box style={{
                  width:  sp.to(v => Math.round(indicator.size + 12 * clamp01(v))),
                  height: indicator.size,
                  borderRadius: indicator.size / 2,
                  backgroundColor: running
                    ? pulse.to(v => `rgba(125, 211, 252, ${(0.55 + 0.45 * v).toFixed(3)})`)
                    : sp.to(v => `rgba(125, 211, 252, ${(0.9 * clamp01(v)).toFixed(3)})`),
                }} />
              </Button>
            </animated.Box>
          );
        })}
      </Box>
    </Box>
  );
}
