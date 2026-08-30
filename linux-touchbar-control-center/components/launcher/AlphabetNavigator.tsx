import React from 'react';
import { Box, Text, motion } from 'react-drm';
import { ALPHABET } from '@/lib/launcher/alphabet';
import {
  ACCENT, ACCENT_NONE, ACCENT_SOFT, FONT, LETTER_ACTIVE, LETTER_DIM, LETTER_SOFT,
  STRIP_BG, STRIP_BORDER,
} from './theme';

const STRIP_H  = 24;
const CELL_GUT = 3;   // pill inset from each cell edge
const PILL_ON  = 20;  // active pill height (grows from center)
const PILL_NB  = 15;  // neighbor pill height (wave tail)
const PILL_OFF = 11;  // resting pill height (transparent, keeps geometry)
const TICK_W   = 12;  // accent underline under the active letter
const TICK_H   = 2.5;

interface FontKey { 0: number; N: number; FAR: number }
const GLYPH: FontKey = { 0: 15, N: 12.5, FAR: 11 };

export interface AlphabetNavigatorProps {
  width:   number; // launcher field width (letters map linearly across it)
  height:  number; // launcher field height
  active:  number; // currently highlighted letter index (0–25)
  visible: boolean;
}

/**
 * The A–Z strip that slides up while the user is swiping. Pure presentation,
 * input lives in TouchBarLauncher. The letters "wave": a translucent accent
 * pill rides the finger (growing from vertical center so the wave never
 * jumps), the glyph under it is the biggest and brightest and gets an accent
 * tick underneath, neighbors taper off in size and color. react-drm can't
 * tween font size, so the glyph falloff is a static 3-step around the active
 * letter — indistinguishable from a true tween at this scale.
 */
export function AlphabetNavigator({ width, height, active, visible }: AlphabetNavigatorProps) {
  const cell = width / ALPHABET.length;
  const pillW = cell - CELL_GUT * 2;

  return (
    <motion.Box
      style={{
        position: 'absolute', left: 0, width, height: STRIP_H,
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: STRIP_BG,
        borderColor: STRIP_BORDER,
        borderWidth: 1,
        borderTopLeftRadius: 12, borderTopRightRadius: 12,
        overflow: 'hidden',
      }}
      // Slide up from below the bar's bottom edge; fade with it.
      animate={{ top: visible ? height - STRIP_H : height, opacity: visible ? 1 : 0 }}
      transition={{ duration: 160 }}
    >
      {ALPHABET.map((letter, i) => {
        const d = Math.min(Math.abs(i - active), ALPHABET.length - Math.abs(i - active));
        const on = d === 0;
        const nb = d === 1;
        const pillH = on ? PILL_ON : nb ? PILL_NB : PILL_OFF;
        return (
          <Box key={letter} style={{ width: cell, height: STRIP_H, alignItems: 'center', justifyContent: 'center' }}>
            {/* Wave pill — grows/shrinks from the strip's vertical center. */}
            <motion.Box
        
              animate={{
                width: pillW, height: pillH,
                left: CELL_GUT, top: (STRIP_H - pillH) / 2,
                borderRadius: pillH / 2,
                
                color: on ? ACCENT : nb ? ACCENT_SOFT : ACCENT_NONE,
              }}
              transition={{ tension: 420, friction: 26 }}
            />
            <Text style={{
              color: on ? LETTER_ACTIVE : nb ? LETTER_SOFT : LETTER_DIM,
              fontSize: on ? GLYPH[0] : nb ? GLYPH.N : GLYPH.FAR,
              fontWeight: on ? '600' : '500',
              fontFamily: FONT,
              textAlign: 'center',
              lineHeight: STRIP_H,
            }}>
              {letter}
            </Text>
            {on && (
              <Box style={{
                position: 'absolute', bottom: 1, width: TICK_W, height: TICK_H,
                borderRadius: TICK_H / 2, backgroundColor: ACCENT,
              }} />
            )}
          </Box>
        );
      })}
    </motion.Box>
  );
}