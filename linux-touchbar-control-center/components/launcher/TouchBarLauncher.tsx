import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Box, Button, Text, motion } from 'react-drm';
import { getInstalledApps } from '@/lib/services/apps';
import type { AppInfo } from '@/lib/services/apps';
import { launch } from '@/lib/services/launch';
import { ALPHABET, letterForName, letterIndexAt, letterOf } from '@/lib/launcher/alphabet';
import { AppItem } from '@/components/launcher/AppItem';
import { AlphabetNavigator } from '@/components/launcher/AlphabetNavigator';
import {
  ACCENT, FONT, LETTER_SOFT, PILL_BG, PILL_BORDER, PILL_BORDER_PRESSED, PILL_PRESSED,
  PILL_RADIUS, PILL_TEXT, PILL_TEXT_DIM,
} from '@/components/launcher/theme';

// ─── Metrics (computed once; apps don't change during a run) ─────────────────

const APPS: AppInfo[] = getInstalledApps();
const NAMES = APPS.map(a => a.name);

// Spacing — the bar is ~2000px wide, so rows get real breathing room.
const PAD      = 16;    // px — gutter on each side of a scrolled row
const ICON_SM  = 26;    // px — app icon glyph
const CHAR_W   = 5.9;   // px — estimated per-character width @ 12.5px Iosevka
const ITEM_PADX = 13;   // px — pill inner horizontal padding
const ITEM_GAP  = 8;    // px — pill icon↔label gap
const ITEM_H_INSET = 6; // px — pill is bar-height minus this
const ROW_GAP   = 10;   // px — spacing between app pills in a row

// Filtered-menu chrome (fixed, doesn't scroll with the apps)
const CLOSE_SZ   = 30;  // px — circular ✕ chip
const CAPTION_W  = 58;  // px — letter · count chip
const HEADER_GAP = 10;  // px — spacing around the header chips
const CONTENT_X  = PAD + CLOSE_SZ + HEADER_GAP + CAPTION_W + HEADER_GAP;

const TAP_MAX_PX    = 10;   // px — max total travel to still count as a tap
const LONG_PRESS_MS = 300;  // ms — hold before a swipe engages the alphabet wave
const SLOP_PX       = 8;    // px — move beyond this before the hold cancels
const ALPHA_PX   = 70;   // px — a flick from the filtered menu must reach this far
const ALPHA_MS   = 240;  // px — …this fast to re-enter the alphabet wave
const AXIS_PX    = 12;   // px — travel past which we commit to an axis
const MOM_MIN      = 0.5; // px/frame — release velocity to start momentum
const MOM_FRICTION = 0.92;
const MOM_STOP     = 0.18;
const JUMP_PAD     = 18;  // px — reveal the section this far from the left edge
const BUFFER_PX    = 180; // px — virtualization overscan each side
const ALPHA_DIM    = 0.18; // opacity of the app row while the wave is up

const CLOSE = -2; // hit-test result: the ✕ chip

const itemWidth = (name: string) =>
  2 * ITEM_PADX + ICON_SM + ITEM_GAP + Math.max(3, Math.round(name.length * CHAR_W));

const WIDTHS  = NAMES.map(itemWidth);
const PREFIX: number[] = [0];
for (let i = 0; i < WIDTHS.length; i++) PREFIX.push(PREFIX[PREFIX.length - 1] + WIDTHS[i] + ROW_GAP);
const TOTAL = PREFIX[PREFIX.length - 1];

// First sorted item index per starting letter (used by the alphabet jump).
const FIRST_BY_LETTER = new Map<number, number>();
for (let i = 0; i < APPS.length; i++) {
  const l = letterForName(NAMES[i]);
  if (l !== -1 && !FIRST_BY_LETTER.has(l)) FIRST_BY_LETTER.set(l, i);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Largest index whose left edge is ≤ `world` in a widths prefix array. */
function indexAt(prefix: number[], world: number): number {
  let lo = 0, hi = prefix.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (prefix[mid] <= world) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Prefix array for the filtered menu's apps (scroll region only). */
const filterPrefix = (filtered: AppInfo[]) => {
  const p = [0];
  for (const a of filtered) p.push(p[p.length - 1] + itemWidth(a.name) + ROW_GAP);
  return p;
};

type Mode = 'apps' | 'alpha' | 'filtered';
type Axis = 'h' | 'v' | null;

interface TouchState {
  sx: number; sy: number;      // gesture origin (layout coords)
  startOff: number;            // scroll offset at gesture start
  startT: number;              // gesture timestamp (flick speed check)
  axis: Axis;                  // committed once travel passes AXIS_PX
  longPress: boolean;          // held still long enough to arm the alphabet
  lastX: number; lastT: number;
  prevX: number; prevT: number;
}

/**
 * The launcher layer: every installed app as a horizontal, virtualized row
 * of glass chips, with a Niagara-style "wave alphabet" on top.
 *
 *  · tap                    → launch the app under your finger.
 *  · hold + swipe           → wave-alphabet mode: the row dims out in place,
 *    an A–Z strip slides up, the letter under your finger swells (the wave)
 *    and the section is previewed behind it. Releasing opens a **filtered
 *    menu** with just that letter's apps.
 *  · plain horizontal drag  → scrolls the app row (with fling momentum).
 *  · filtered menu          → fixed ✕ + "letter · count" header, the section's
 *    apps scroll beside it; tap to launch, ✕ to return, or flick to re-enter
 *    the alphabet and pick again.
 *  · vertical-dominant drags are ignored outright (the bar mustn't scroll
 *    vertically) — see the `axis` commit logic.
 */
export function TouchBarLauncher({ width, height, offsetX }: {
  width: number;   // launcher field width
  height: number;  // launcher field height
  offsetX: number; // field's origin in layout coords (back-button gutter)
}) {
  const [mode, setMode] = useState<Mode>('apps');
  const [scrollX, setScrollX] = useState(0);
  const [filterScrollX, setFilterScrollX] = useState(0);
  const [activeLetter, setActiveLetter] = useState(letterIndexAt(width / 2, width));
  const [filterLetter, setFilterLetter] = useState(0);
  const [pressed, setPressed] = useState(-1); // index in the *current* row, -1 none

  const scrollRef  = useRef(0);
  const fScrollRef = useRef(0);
  const modeRef    = useRef<Mode>(mode);
  const letterRef  = useRef(activeLetter);
  const touch      = useRef<TouchState>({ sx: 0, sy: 0, startOff: 0, startT: 0, axis: null, longPress: false, lastX: 0, lastT: 0, prevX: 0, prevT: 0 });
  const momTimer   = useRef<ReturnType<typeof setInterval> | null>(null);
  const lpTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const maxScroll = Math.max(0, TOTAL + PAD + PAD - width);

  // The filtered menu for the current letter (recomputed only on letter change).
  const filtered = useMemo(
    () => APPS.filter(a => letterForName(a.name) === filterLetter),
    [filterLetter],
  );
  const fPrefix = useMemo(() => filterPrefix(filtered), [filtered]);
  const fTotal  = fPrefix[fPrefix.length - 1];
  const fViewW  = Math.max(0, width - CONTENT_X - PAD);
  const maxFScroll = Math.max(0, fTotal - fViewW);

  // Keep refs in sync for the raw touch handlers (they must not close over state).
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { letterRef.current = activeLetter; }, [activeLetter]);

  const stopTimers = () => {
    if (momTimer.current) { clearInterval(momTimer.current); momTimer.current = null; }
    if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; }
  };
  useEffect(() => stopTimers, []);

  const scrollNow = (v: number, isFiltered: boolean) => {
    const ref  = isFiltered ? fScrollRef : scrollRef;
    const set  = isFiltered ? setFilterScrollX : setScrollX;
    const hi   = isFiltered ? maxFScroll : maxScroll;
    const next = clamp(v, 0, hi);
    ref.current = next;
    set(next);
  };

  /** First index of `letter`, falling forward to the next populated letter. */
  const firstAppForLetter = (letter: number): number | undefined => {
    for (let l = letter; l < ALPHABET.length; l++) {
      const first = FIRST_BY_LETTER.get(l);
      if (first !== undefined) return first;
    }
    return undefined;
  };

  /** Scroll the full list straight to the first app of `letter`'s section. */
  const scrollAppsToLetter = (letter: number) => {
    const first = firstAppForLetter(letter);
    if (first === undefined) return; // nothing from here on → keep position
    scrollNow(PREFIX[first] - JUMP_PAD, false);
  };

  const enterAlphaAt = (localX: number) => {
    const letter = letterIndexAt(localX, width);
    letterRef.current = letter;
    setActiveLetter(letter);
    setMode('alpha');
    setPressed(-1);
    scrollAppsToLetter(letter);
  };

  const releaseMomentum = (isFiltered: boolean) => {
    const t = touch.current;
    const now = Date.now();
    const dt = t.lastT - t.prevT;
    if (dt <= 0 || now - t.lastT > 40) return;
    let vel = ((t.lastX - t.prevX) / dt) * 16;
    if (Math.abs(vel) < MOM_MIN) return;
    const ref = isFiltered ? fScrollRef : scrollRef;
    const set = isFiltered ? setFilterScrollX : setScrollX;
    const hi  = isFiltered ? maxFScroll : maxScroll;
    if ((vel < 0 && ref.current <= 0) || (vel > 0 && ref.current >= hi)) return;
    momTimer.current = setInterval(() => {
      vel *= MOM_FRICTION;
      const cur = ref.current;
      const next = clamp(cur + vel, 0, hi);
      if (Math.abs(vel) < MOM_STOP || next === cur) { clearInterval(momTimer.current!); momTimer.current = null; return; }
      ref.current = next;
      set(next);
    }, 16);
  };

  // ── Hit testing ─────────────────────────────────────────────────────────────

  const appsHitAt = (localX: number): number => {
    const world = PAD + localX + scrollRef.current;
    if (world < PAD || world > PAD + TOTAL) return -1;
    const i = indexAt(PREFIX, world);
    return i >= APPS.length ? -1 : i;
  };

  /** CLOSE for the ✕ chip, a filtered index ≥ 0 for an app, -1 for empty space. */
  const filterHitAt = (localX: number): number => {
    if (localX < PAD) return -1;
    if (localX < PAD + CLOSE_SZ) return CLOSE;
    if (localX < CONTENT_X) return -1; // caption zone
    const world = localX - CONTENT_X + fScrollRef.current;
    if (world < 0 || world > fTotal) return -1;
    return indexAt(fPrefix, world);
  };

  // ── Raw touch input (react-drm delivers layout coords) ─────────────────────

  const onTouchStart = (x: number, y: number) => {
    stopTimers();
    const t = touch.current;
    t.sx = x; t.sy = y;
    t.startOff = modeRef.current === 'filtered' ? fScrollRef.current : scrollRef.current;
    t.startT = Date.now();
    t.axis = null;
    t.longPress = false;
    t.lastX = x; t.lastT = t.startT;
    t.prevX = x; t.prevT = t.startT;

    const localX = x - offsetX;
    if (modeRef.current === 'apps') setPressed(appsHitAt(localX));
    else if (modeRef.current === 'filtered') setPressed(filterHitAt(localX));

    // Arm the alphabet wave only from a still hold — a plain drag just scrolls.
    if (modeRef.current === 'apps') {
      lpTimer.current = setTimeout(() => {
        t.longPress = true;
        lpTimer.current = null;
      }, LONG_PRESS_MS);
    }
  };

  const onTouchMove = (x: number, y: number) => {
    const t = touch.current;
    const now = Date.now();
    if (now - t.lastT > 5) { t.prevX = t.lastX; t.prevT = t.lastT; }
    t.lastX = x; t.lastT = now;

    const dx = x - t.sx;
    const dy = y - t.sy;

    // Commit an axis once real movement happens; vertical wins → ignore
    // everything (prevents accidental vertical "scroll" or launches).
    if (!t.axis && Math.max(Math.abs(dx), Math.abs(dy)) > AXIS_PX) {
      t.axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
    }
    if (t.axis === 'v') {
      // Vertical intent cancels a pending hold (no wave, no scroll).
      if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; }
      t.longPress = false;
      return;
    }

    const localX = x - offsetX;
    const m = modeRef.current;

    if (m === 'alpha') {
      const letter = letterIndexAt(localX, width);
      if (letter !== letterRef.current) {
        letterRef.current = letter;
        setActiveLetter(letter);
        scrollAppsToLetter(letter);
      }
      return;
    }

    if (m === 'apps') {
      // Row scrolls on a plain horizontal drag; the alphabet wave is gated
      // behind a long-press + swipe.
      if (t.axis === 'h') {
        // Moving before the hold matured → this is a scroll, cancel the hold.
        if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; }
        if (t.longPress) {
          enterAlphaAt(localX);
        } else {
          scrollNow(t.startOff - dx, false);
        }
      }
      return;
    }

    // Filtered menu: drag to scroll within the section…
    if (!t.axis || dx < 0) {
      setPressed(-1);
      scrollNow(t.startOff - dx, true);
    }

    // …and a quick flick returns to the alphabet to pick another letter.
    if (t.axis === 'h' && dx >= ALPHA_PX && now - t.startT < ALPHA_MS) {
      letterRef.current = filterLetter;
      setActiveLetter(filterLetter);
      setMode('alpha');
      setPressed(-1);
      scrollAppsToLetter(filterLetter);
    }
  };

  const onTouchEnd = (x: number, y: number) => {
    const t = touch.current;
    if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; }
    const now = Date.now();
    const dx = x - t.sx;
    const dy = y - t.sy;
    const moved = Math.hypot(dx, dy);

    if (modeRef.current === 'alpha') {
      // Releasing on a letter opens that letter's filtered menu.
      setFilterLetter(letterRef.current);
      setFilterScrollX(0);
      fScrollRef.current = 0;
      setMode('filtered');
      setPressed(-1);
      t.axis = null;
      t.longPress = false;
      return;
    }

    const filtered_ = modeRef.current === 'filtered';

    if (t.axis !== 'v' && moved <= TAP_MAX_PX) {
      const idx = filtered_
        ? filterHitAt(x - offsetX)
        : appsHitAt(x - offsetX);
      if (idx === CLOSE) {
        setMode('apps');
      } else if (idx >= 0 && filtered_) {
        launch(filtered[idx].command, filtered[idx].args);
      } else if (idx >= 0) {
        launch(APPS[idx].command, APPS[idx].args);
      }
    } else if (t.axis === 'h' && !filtered_) {
      // Scroll of the main apps row → release with fling momentum.
      releaseMomentum(false);
    } else if (t.axis === 'h' && filtered_) {
      releaseMomentum(true);
    }

    setPressed(-1);
    t.axis = null;
    t.longPress = false;
  };

  // ── Virtualized rows ────────────────────────────────────────────────────────

  const itemH  = Math.max(30, height - ITEM_H_INSET);
  const top    = Math.max(0, (height - itemH) / 2);
  const chipH  = Math.min(CLOSE_SZ, itemH);
  const appsEmpty = APPS.length === 0;

  const aStart = Math.max(0, indexAt(PREFIX, scrollX - PAD - BUFFER_PX) - 1);
  const aEnd   = Math.min(APPS.length - 1, indexAt(PREFIX, scrollX - PAD + width + BUFFER_PX) + 1);

  // The app the alphabet cursor is aimed at (first of `letter`'s section,
  // falling forward to the next populated letter when it's empty).
  const activeIdx = mode === 'alpha' ? (firstAppForLetter(activeLetter) ?? -1) : -1;

  const fStart = Math.max(0, indexAt(fPrefix, filterScrollX - BUFFER_PX) - 1);
  const fEnd   = Math.min(filtered.length - 1, indexAt(fPrefix, filterScrollX + fViewW + BUFFER_PX) + 1);

  const appsRow = (
    <Box style={{ position: 'absolute', left: 0, top: 0, width, height, overflow: 'hidden' }}>
      {aStart <= aEnd && APPS.slice(aStart, aEnd + 1).map((app, k) => {
        const i = aStart + k;
        return (
          <AppItem
            key={app.id}
            name={app.name}
            iconSrc={app.iconSrc}
            left={PAD + PREFIX[i] - scrollX}
            top={top}
            width={WIDTHS[i]}
            height={itemH}
            pressed={mode === 'apps' && i === pressed}
            active={i === activeIdx}
            iconSize={ICON_SM}
            font={FONT}
          />
        );
      })}
    </Box>
  );

  const filteredRow = (
    <Box style={{ position: 'absolute', left: 0, top: 0, width, height, overflow: 'hidden' }}>
      {/* Fixed chrome — the ✕ chip and the section caption. */}
      <Box style={{
        position: 'absolute',
        left: PAD, top: (height - chipH) / 2, width: chipH, height: chipH,
        alignItems: 'center', justifyContent: 'center',
        borderRadius: chipH / 2,
        backgroundColor: pressed === CLOSE ? PILL_PRESSED : PILL_BG,
        borderColor: pressed === CLOSE ? PILL_BORDER_PRESSED : PILL_BORDER,
        borderWidth: 1,
        shadowColor: '#000000', shadowOffsetY: 1, shadowOpacity: 0.28, shadowRadius: 3,
      }}>
        <Text style={{ color: PILL_TEXT, fontSize: 12, fontFamily: FONT, fontWeight: '600' }}>✕</Text>
      </Box>

      <Box style={{
        position: 'absolute',
        left: PAD + chipH + HEADER_GAP, top, width: CAPTION_W, height: itemH,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
        borderRadius: PILL_RADIUS,
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        borderColor: PILL_BORDER, borderWidth: 1,
      }}>
        <Text style={{ color: ACCENT, fontSize: 13, fontFamily: FONT, fontWeight: '700' }}>
          {letterOf(filterLetter)}
        </Text>
        <Text style={{ color: LETTER_SOFT, fontSize: 10.5, fontFamily: FONT }}>{`· ${filtered.length}`}</Text>
      </Box>

      {/* Scrolling apps — fades in fresh on every letter change. */}
      {fStart <= fEnd && (
        <motion.Box
          key={filterLetter}
          style={{ position: 'absolute', left: CONTENT_X, top: 0, width: fViewW, height, overflow: 'hidden' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 140 }}
        >
          {filtered.slice(fStart, fEnd + 1).map((app, k) => {
            const i = fStart + k;
            return (
              <AppItem
                key={app.id}
                name={app.name}
                iconSrc={app.iconSrc}
                left={fPrefix[i] - filterScrollX}
                top={top}
                width={itemWidth(app.name)}
                height={itemH}
                pressed={i === pressed}
                iconSize={ICON_SM}
                font={FONT}
              />
            );
          })}
        </motion.Box>
      )}
    </Box>
  );

  if (appsEmpty) {
    return (
      <Button width={width} height={height} color="transparent" activeColor="transparent"
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        style={{ position: 'relative', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' }}
      >
        <Text style={{ color: PILL_TEXT_DIM, fontSize: 12, fontFamily: FONT }}>No applications found</Text>
      </Button>
    );
  }

  return (
    <Button
      width={width} height={height}
      color="transparent" activeColor="transparent"
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
      style={{ position: 'relative', overflow: 'hidden', backgroundColor: 'transparent' }}
    >
      {mode === 'filtered'
        ? filteredRow
        : (
          // α-mode: apps stay visible but dimmed out beneath the alphabet wave.
          <Box style={{ position: 'absolute', left: 0, top: 0, width, height, opacity: mode === 'alpha' ? ALPHA_DIM : 1 }}>
            {appsRow}
          </Box>
        )}

      <AlphabetNavigator width={width} height={height} active={activeLetter} visible={mode === 'alpha'} />

      {/* Big centered letter preview — heads-up indicator while scrubbing A–Z. */}
      <motion.Box
        style={{
          position: 'absolute', left: 0, top: 0, width, height,
          alignItems: 'center', justifyContent: 'center',
        }}
        animate={{ opacity: mode === 'alpha' ? 1 : 0 }}
        transition={{ duration: 120 }}
      >
        <Text style={{
          fontSize: 88, fontWeight: '800', fontFamily: FONT,
          color: 'rgba(255, 255, 255, 0.10)', lineHeight: 1,
        }}>
          {letterOf(activeLetter)}
        </Text>
      </motion.Box>

      {/* Overscroll hint on the right when a row extends past the bar. */}
      {((mode === 'apps' && scrollX < maxScroll) || (mode === 'filtered' && filterScrollX < maxFScroll)) && (
        <Box style={{
          position: 'absolute', right: 3, top: (height - 26) / 2, width: 4, height: 26,
          backgroundColor: 'rgba(255, 255, 255, 0.16)',
           borderRadius: 2,
        }} />
      )}
    </Button>
  );
}