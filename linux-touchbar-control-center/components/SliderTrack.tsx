import React from 'react';
import { Box } from 'react-drm';

// Real macOS Touch Bar OSD slider: a thin line with a large gray knob that
// carries the icon and rides on top of it at all times — not a Control
// Center panel pill. Filled (left of knob) is a thicker bright line; empty
// (right of knob) is a thin translucent one.
const KNOB_D        = 32;
const LINE_FILLED_H = 4;
const LINE_EMPTY_H  = 2;

/** Fully-rounded (pill/circle) radius for a box of height `h`. */
const pillRadius = (h: number) => h / 2;

export function SliderTrack({ fill, icon, width }: {
  fill: number;
  icon: React.ReactNode;
  width: number;
}) {
  // Rounded to whole pixels — the native renderer builds each rounded-rect
  // path from these coordinates directly, and fractional edges here can get
  // clipped by a hair on whichever side the fraction lands, depending on the
  // current fill value. Integer pixels keep every edge landing consistently.
  const knobX      = Math.round(Math.max(0, Math.min(width - KNOB_D, fill * width - KNOB_D / 2)));
  const knobCenter = knobX + KNOB_D / 2;
  const filledW    = Math.max(0, Math.min(width, knobCenter));
  const emptyX     = Math.min(width, knobCenter);
  const emptyW     = Math.max(0, width - emptyX);

  return (
    <Box style={{ width, height: KNOB_D }}>
      {filledW > 0 && (
        <Box
          style={{
            position: 'absolute', left: 0, top: (KNOB_D - LINE_FILLED_H) / 2,
            width: filledW, height: LINE_FILLED_H, borderRadius: pillRadius(LINE_FILLED_H),
            backgroundColor: '#f5f5f7',
          }}
        />
      )}
      {emptyW > 0 && (
        <Box
          style={{
            position: 'absolute', left: emptyX, top: (KNOB_D - LINE_EMPTY_H) / 2,
            width: emptyW, height: LINE_EMPTY_H, borderRadius: pillRadius(LINE_EMPTY_H),
            backgroundColor: 'rgba(255,255,255,0.22)',
          }}
        />
      )}
      <Box
        style={{
          position: 'absolute', left: knobX, top: 0,
          width: KNOB_D, height: KNOB_D, borderRadius: pillRadius(KNOB_D),
          backgroundColor: 'rgba(70,70,74,0.92)',
          alignItems: 'center', justifyContent: 'center',
          // shadowColor: 'rgba(0,0,0,0.5)', shadowOffsetY: 1, shadowRadius: 4, shadowOpacity: 1,
        }}
      >
        {icon}
      </Box>
    </Box>
  );
}
