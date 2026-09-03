import React, { memo } from 'react';
import { Box, Svg, Text } from 'react-drm';
import {
  ACCENT, FONT, PILL_BG, PILL_BORDER, PILL_BORDER_PRESSED, PILL_PRESSED, PILL_RADIUS, PILL_TEXT,
} from './theme';

export interface AppItemProps {
  name:     string;
  iconSrc:  string | null;
  left:     number; // absolute x within the launcher field
  top:      number;
  width:    number;
  height:   number;
  pressed:  boolean; // active press feedback (tap targeting, not a drag)
  /** Alpha-mode "aimed at" chip — the first app of the letter under the finger. */
  active?:  boolean;
  iconSize: number;
  font:     string;
}

const AVATAR_COLORS = [
  '#2563eb', '#7c3aed', '#0891b2', '#be185d', '#b45309', '#15803d',
] as const;

/** Fallback glyph when no theme/path icon resolves: a colored dot with the initial. */
function LetterAvatar({ name, size, font }: { name: string; size: number; font: string }) {
  const idx = (Math.abs(hash(name)) + 32) % AVATAR_COLORS.length;
  return (
    <Box style={{
      width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
      backgroundColor: AVATAR_COLORS[idx],
      opacity: 0.92,
    }}>
      <Text style={{ color: '#0b0f14', fontSize: Math.round(size * 0.55), fontFamily: font, fontWeight: '700' }}>
        {name.trim().charAt(0).toUpperCase()}
      </Text>
    </Box>
  );
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * One alphabet slot in the launcher row: a translucent glass chip (hairline
 * border, soft drop shadow). Intentionally a plain Box (no own gesture) —
 * taps/drags are owned by the single launcher gesture surface so scroll vs.
 * alphabet-swipe disambiguation stays in one place.
 */
export const AppItem = memo(function AppItem({
  name, iconSrc, left, top, width, height, pressed, active, iconSize, font,
}: AppItemProps) {
  return (
    <Box style={{
      position: 'absolute', left, top, width, height,
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 13,
      borderRadius: PILL_RADIUS,
      backgroundColor: active ? 'rgba(91, 141, 239, 0.16)' : pressed ? PILL_PRESSED : PILL_BG,
      borderColor: active ? ACCENT : pressed ? PILL_BORDER_PRESSED : PILL_BORDER,
      borderWidth: 1,
      shadowColor: active ? ACCENT : '#000000',
      shadowOffsetY: 1,
      shadowOpacity: active ? 0.4 : pressed ? 0.12 : 0.28,
      shadowRadius: active ? 5 : 3,
      overflow:"hidden"
    }}>
      {iconSrc
        ? <Svg src={iconSrc} width={iconSize} height={iconSize} style={{ width: iconSize, height: iconSize }} />
        : <LetterAvatar name={name} size={iconSize} font={font} />}
      <Text style={{ color: active ? '#ffffff' : PILL_TEXT, fontSize: 10.5, fontFamily: font, fontWeight: active ? '600' : '500' }}>
        {name}
      </Text>
    </Box>
  );
});