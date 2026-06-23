import React, { useEffect, useMemo, useState, useRef, useContext } from 'react';
import { Box, Text, Button, Svg, LayoutContext, animated, useSpringValue } from 'react-drm';
import type { BoxNode } from 'react-drm';
import {
  MdSkipPrevious, MdPlayArrow, MdPause, MdSkipNext,
} from 'react-icons/md';
import { useMediaPlayers } from '../../hooks/useMediaPlayers';
import { useAlbumArt } from '../../hooks/useAlbumArt';
import { appIconSource } from '../../services/appIcon';

const ACCENT: Record<string, string> = {
  firefox: '#f9731666',
  spotify: '#1db95466',
  chrome:  '#4285f466',
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

type Player = ReturnType<typeof useMediaPlayers>['players'][number];

const BG_CARD = '#444'; // each accordion item sits on this card background
const SEP     = '#000000'; // divider between control buttons

// Freedesktop icon name per player, resolved to a renderable <Svg> path once
// (appIconSource memoises). Falls back to the album-art vinyl when not found.
const APP_ICON: Record<string, string> = {
  firefox: 'firefox',
  spotify: 'spotify',
  chrome: 'google-chrome',
};
function iconSrcFor(name: string): string | null {
  return appIconSource(APP_ICON[name] ?? name);
}

// One accordion item on a card background. Its width is a spring: it slides to
// `expandedW` when selected and back to `collapsedW` otherwise. Selected = full
// transport + vinyl + title/artist; collapsed = a square app-icon tile (tap to
// expand). overflow:hidden so the wider content clips smoothly while it grows.
function AccordionItem({ player, isSel, expandedW, collapsedW, height, onSelect }: {
  player: Player; isSel: boolean; expandedW: number; collapsedW: number; height: number; onSelect: () => void;
}) {
  const w = useSpringValue(isSel ? expandedW : collapsedW, { config: { tension: 280, friction: 30 } });
  useEffect(() => { w.start(isSel ? expandedW : collapsedW); }, [isSel, expandedW, collapsedW, w]);

  const color   = ACCENT[player.name] ?? '#666';
  const iconSz  = 38;
  const vinylSz   = Math.round(height * 0.9);
  const iconBox   = Math.round(height*0.8);  // collapsed tile app icon
  const appIconSz = Math.round(height*0.8 ); // app icon shown in expanded row
  const playing = player.state.status === 'Playing';
  const PlayIcon = playing ? MdPause : MdPlayArrow;
  const icon    = iconSrcFor(player.name);
  const sepH    = Math.round(height );

  // Tap / drag anywhere on the bar to seek. Touch x is absolute, so map it
  // through the bar node's live layout box (same as Button hit-testing).
  const [dragUs, setDragUs] = useState<number | null>(null);
  const layoutCtx = useContext(LayoutContext);
  const barRef    = useRef<BoxNode | null>(null);

  const len      = player.state.length;
  const shownPos = dragUs ?? player.state.position; // show the drag preview while scrubbing
  const frac     = len > 0 ? Math.max(0, Math.min(1, shownPos / len)) : 0;
  const barH     = height; // progress bar spans the full item height
  // Bar fills the row remainder: total minus the fixed siblings + their gaps (8).
  // Separators: icon|prev (only with an icon), prev|play, play|next.
  const sepN     = icon ? 3 : 2;
  const fixedW   = (icon ? appIconSz : 0) + 120 + 120 + 120 + vinylSz + sepN;
  const childN   = (icon ? 1 : 0) + 3 /*controls*/ + sepN + 2 /*vinyl + bar*/;
  const barW     = Math.max(60, Math.round(expandedW - fixedW - (childN - 1) * 8));
  const fillW    = Math.round(barW * frac);

  const seekFrom = (tx: number, commit: boolean) => {
    const lb = barRef.current ? layoutCtx.current.get(barRef.current) : undefined;
    if (!lb || lb.w <= 0 || len <= 0) { if (commit) setDragUs(null); return; }
    const f = Math.max(0, Math.min(1, (tx - lb.x) / lb.w));
    if (commit) { player.seek(f * len); setDragUs(null); }
    else setDragUs(Math.round(f * len));
  };

  return (
    <animated.Box style={{ width: w, height, overflow: 'hidden', borderRadius: 10, backgroundColor: (playing && !isSel) ? color : BG_CARD, flexDirection: 'row', alignItems: 'center', justifyContent: isSel ? 'flex-start' : 'center', gap: 8, paddingLeft: 6, paddingRight: 6 }}>
      {isSel ? (
        <>
          {/* app icon */}
          {icon && <Svg src={icon} width={appIconSz} height={appIconSz} style={{ width: appIconSz, height: appIconSz }} />}
          {icon && <Box style={{ width: 2, height: sepH*2, backgroundColor: SEP+"99" }} />}
          {/* prev */}
          <Button width={120} height={48} color="transparent" activeColor="#555555" style={{ alignItems: 'center', justifyContent: 'center', borderRadius: 6 }} onClick={player.previous}>
            <MdSkipPrevious style={{ width: iconSz, height: iconSz }} fill="#fff" />
          </Button>
          <Box style={{ width: 1, height: sepH, backgroundColor: SEP }} />
          {/* play/pause (icon tinted with the player accent) */}
          <Button width={120} height={48} color="transparent" activeColor="#555555" onClick={player.playPause} style={{ alignItems: 'center', justifyContent: 'center', borderRadius: 6 }}>
            <PlayIcon style={{ width: iconSz, height: iconSz }} fill={"#fff"} />
          </Button>
          <Box style={{ width: 1, height: sepH, backgroundColor: SEP }} />
          {/* next */}
          <Button width={120} height={48} color="transparent" activeColor="#555555" style={{ alignItems: 'center', justifyContent: 'center', borderRadius: 6 }} onClick={player.next}>
            <MdSkipNext style={{ width: iconSz, height: iconSz }} fill="#fff" />
          </Button>
          <Box style={{ width: 1, height: sepH, backgroundColor: SEP }} />  
          {/* flat progress bar — tap or drag to seek; track text sits inside */}
          <Button
            width={barW}
            height={barH}
            color="transparent"
            activeColor="transparent"
            onTouchStart={(tx) => seekFrom(tx, false)}
            onTouchMove={(tx) => seekFrom(tx, false)}
            onTouchEnd={(tx) => seekFrom(tx, true)}
            onTouchCancel={() => setDragUs(null)}
            style={{ borderRadius: 0 }}
          >
            <Box ref={barRef} style={{ width: barW, height: barH, position: 'relative', borderRadius: 0, overflow: 'hidden'}}>
            
          <Box style={{ height , width:vinylSz , position:"absolute",zIndex:2 ,alignItems:"center"}}>

          <Vinyl size={height-2} accent={color} artUrl={player.state.artUrl} spinning={playing}  />
          </Box>
              {fillW > 0 && <Box style={{ position: 'absolute', left: vinylSz/2, top: 0, width: fillW - (vinylSz/2), height: barH, backgroundColor: color }} />}
              <Box style={{ marginLeft: vinylSz, position: 'absolute', left: 0, top: 0, width: barW - (vinylSz), height: barH, flexDirection: 'column', justifyContent: 'center', paddingLeft: 10, paddingRight: 10,zIndex:-1 }}>
                <Text  color="#fff" fontSize={15} fontFamily={FONT}>{player.state.title || 'Unknown'}</Text>
                <Text color="#cbd5e1" fontSize={12} fontFamily={FONT}>{player.state.artist}</Text>
              </Box>
            </Box>
          </Button>
        </>
      ) : (
        // collapsed: a square app-icon tile; tap to expand. Falls back to the
        // album-art vinyl when the app icon can't be resolved. When playing, the
        // wrapper above is accent-tinted (full-bleed) so this tile stands out;
        // the button itself stays transparent so that fill shows through.
        <Button width={collapsedW - 12} height={height} color="transparent" activeColor="#1e293b" onClick={onSelect} style={{ alignItems: 'center', justifyContent: 'center', borderRadius: 6 }}>
          {icon
            ? <Svg src={icon} width={iconBox} height={iconBox} style={{ width: iconBox, height: iconBox }} />
            : <Vinyl size={vinylSz} accent={color} artUrl={player.state.artUrl} spinning={playing} />}
        </Button>
      )}
    </animated.Box>
  );
}

export function MediaMprisList({ width, height }: { width: number; height: number }) {
  const { players } = useMediaPlayers();

  // Track the selected player by its service id (stable across list changes).
  // If the selected player disappears we fall back to the first one — no stale
  // index can push anything off-screen.
  const [selectedService, setSelectedService] = useState<string | null>(null);

  if (players.length === 0) {
    return (
      <Box style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 8 }}>
        <Text color="#94a3b8" fontSize={14} fontFamily={FONT}>
          No media players
        </Text>
      </Box>
    );
  }

  const selected   = players.find(p => p.service === selectedService) ?? players[0];
  const collapsedW = height; // square tile per collapsed player
  // The selected item takes whatever width the collapsed tiles leave behind.
  const gaps       = Math.max(0, players.length - 1) * 6;
  const expandedW  = Math.max(160, width - (players.length - 1) * collapsedW - gaps);

  return (
    <Box style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {players.map((player) => (
        <AccordionItem
          key={player.service}
          player={player}
          isSel={player.service === selected.service}
          expandedW={expandedW}
          collapsedW={collapsedW}
          height={height}
          onSelect={() => setSelectedService(player.service)}
        />
      ))}
    </Box>
  );
}
