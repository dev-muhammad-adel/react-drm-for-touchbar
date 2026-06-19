import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, Button, SwipeZone, Svg, animated, useSpringValue } from 'react-drm';
import {
  MdSkipPrevious, MdPlayArrow, MdPause, MdSkipNext,
  MdChevronLeft, MdChevronRight,
} from 'react-icons/md';
import { useMediaPlayers } from '../../hooks/useMediaPlayers';
import { useAlbumArt } from '../../hooks/useAlbumArt';
import { CgChevronDoubleDown } from 'react-icons/cg';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa6';

const ACCENT: Record<string, string> = {
  spotify: '#1db954',
  chrome:  '#4285f4',
};

const FONT = '';

// Build the vinyl record as one cached SVG: black disc, a few groove rings, the
// album art clipped to a circle (when present), a colored center label and the
// spindle hole. Rendered once per track; the spinning is done by rotating the
// wrapping Box, so this markup stays constant (and cached) frame to frame.
function buildVinylSvg(size: number, accent: string, artUri: string | null): string {
  const c       = size / 2;
  const rOuter  = size / 2;
  const rArt    = size * 0.42;
  const rLabel  = size * 0.17;
  const rHole   = Math.max(1.5, size * 0.035);
  const groove  = Math.max(1, size * 0.012);

  const grooves = [0.92, 0.80, 0.68, 0.56].map(f =>
    `<circle cx="${c}" cy="${c}" r="${(rOuter * f).toFixed(2)}" fill="none" stroke="#000" stroke-opacity="0.5" stroke-width="${groove.toFixed(2)}"/>`
  ).join('');

  const art = artUri
    ? `<clipPath id="art"><circle cx="${c}" cy="${c}" r="${rArt.toFixed(2)}"/></clipPath>` +
      `<image href="${artUri}" x="${(c - rArt).toFixed(2)}" y="${(c - rArt).toFixed(2)}" ` +
      `width="${(rArt * 2).toFixed(2)}" height="${(rArt * 2).toFixed(2)}" ` +
      `preserveAspectRatio="xMidYMid slice" clip-path="url(#art)"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<circle cx="${c}" cy="${c}" r="${rOuter.toFixed(2)}" fill="#0a0a0a"/>` +
    grooves +
    art +
    `<circle cx="${c}" cy="${c}" r="${rLabel.toFixed(2)}" fill="${accent}"/>` +
    `<circle cx="${c}" cy="${c}" r="${rHole.toFixed(2)}" fill="#0a0a0a"/>` +
    `</svg>`;
}

// Spinning vinyl. The disc is a static cached SVG; the rotation is a real Box
// transform (style.rotate, degrees) driven by a looping spring — only while the
// track is playing. Paused → the spring stops and the angle holds.
function Vinyl({ size, accent, artUrl, spinning }: { size: number; accent: string; artUrl: string; spinning: boolean }) {
  const artUri = useAlbumArt(artUrl || undefined);
  const spin   = useSpringValue(0);

  useEffect(() => {
    if (spinning) {
      const from = spin.get();
      // +360 per loop → seamless wrap (0° ≡ 360°); linear easing for constant speed.
      spin.start({ from, to: from + 360, loop: true, config: { duration: 4000, easing: (t: number) => t } });
    } else {
      spin.stop();
    }
    return () => { spin.stop(); };
  }, [spinning, spin]);

  const markup = useMemo(() => buildVinylSvg(size, accent, artUri), [size, accent, artUri]);

  return (
    <animated.Box style={{ width: size, height: size, rotate: spin }}>
      <Svg src={markup} width={size} height={size} />
    </animated.Box>
  );
}

export function MediaMprisList({ width, height }: { width: number; height: number }) {
  const { players } = useMediaPlayers();

  const [index, setIndex] = useState(0);
  const [dragX, setDragX] = useState(0);


  // const current = players[safeIndex];

const next = () => {
  if (index >= players.length - 1) return;
  setIndex(i => i + 1);
};

const prev = () => {
  if (index <= 0) return;
  setIndex(i => i - 1);
};

  const iconSz = Math.round(height * 0.48);
const itemWidth = width - 12 * 2 - 6 * 2; // left/right padding + gap
  const trackWidth = useMemo(() => players.length * itemWidth, [players.length, itemWidth]);

  if (players.length === 0) {
    return (
      <Box style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 8 }}>
        <Text color="#94a3b8" fontSize={14} fontFamily={FONT}>
          No media players
        </Text>
      </Box>
    );
  }

  return (
    <Box style={{ flex: 1, flexDirection: 'row', alignItems: 'center',gap:6 }}>

      {/* left arrow */}
      <FaChevronLeft style={{ width: 12, height: 12 }} fill="#fff" />

      {/* VIEWPORT */}
      <Box
        style={{
          flex: 1,
          overflow: 'hidden',
          flexDirection: 'row',
        }}
      >

        <SwipeZone
          width={width}
          height={height}
          threshold={80}
          onScrollMove={(dx) => setDragX(dx)}
          onScrollEnd={() => setDragX(0)}
          onSwipeLeft={() => {
            setDragX(0);
            next();
          }}
          onSwipeRight={() => {
            setDragX(0);
            prev();
          }}
        >

          {/* TRACK */}
          <Box
            style={{
              flexDirection: 'row',
              width: trackWidth,
              marginLeft: -(index * itemWidth) + dragX,
            }}
          >

            {players.map((player, i) => {
              const color = ACCENT[player.name] ?? '#666';

              return (
                <Box
                  key={player.name + i}
                  style={{
                    width: itemWidth,
                    height,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingLeft: 8,
                    paddingRight: 8,
                    borderRadius: 8,
                    // backgroundColor: i === 0 ? 'red' : 'blue',
                  }}
                >

                  {/* prev */}
                  <Button
                    width={60}
                    height={height}
                    color="#3a3a3a" activeColor="#4f4b4f" style={{ alignItems: 'center', justifyContent: 'center', borderRadius: 6 }}
                    onClick={player.previous}
                  >
                    <MdSkipPrevious style={{ width: iconSz, height: iconSz }} />
                  </Button>

                  {/* play/pause */}
                  <Button
                    width={100}
                    height={height}
                    color={color}
                    onClick={player.playPause}
                    style={{ alignItems: 'center', justifyContent: 'center', borderRadius: 6 }}
                  >
                    {player.state.status === 'Playing'
                      ? <MdPause style={{ width: iconSz, height: iconSz }} />
                      : <MdPlayArrow style={{ width: iconSz, height: iconSz }} />
                    }
                  </Button>

                  {/* next */}
                  <Button
                    width={60}
                    height={height}
                    color="#3a3a3a" activeColor="#4f4b4f" style={{ alignItems: 'center', justifyContent: 'center', borderRadius: 6 }}
                    onClick={player.next}
                  >
                    <MdSkipNext style={{ width: iconSz, height: iconSz }} />
                  </Button>

                  {/* spinning vinyl with album art */}
                  <Vinyl
                    size={Math.round(height * 0.9)}
                    accent={color}
                    artUrl={player.state.artUrl}
                    spinning={player.state.status === 'Playing'}
                  />

                  {/* text */}
                  <Box style={{ flexDirection: 'column' }}>
                    <Text color="#fff" fontSize={15} fontFamily={FONT}>
                      {player.state.title || 'Unknown'}
                    </Text>

                    <Text color="#94a3b8" fontSize={12} fontFamily={FONT}>
                      {player.state.artist}
                    </Text>
                  </Box>

                </Box>
              );
            })}

          </Box>
        </SwipeZone>
      </Box>

      {/* right arrow */}
      <FaChevronRight style={{ width: 12, height: 12 }} fill="#fff" />

    </Box>
  );
}