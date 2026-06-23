import React, { useEffect, useMemo, useRef } from 'react';
import { Box, Button, KEY, animated, useSpringValue } from 'react-drm';
import { useAtom } from 'jotai';
import { FaChevronLeft, FaLinux } from 'react-icons/fa6';
import { MdPlayArrow, MdVolumeUp, MdWbSunny, MdSearch, MdMusicNote } from 'react-icons/md';
import { LayerHost, useLayers } from '.';
import type { Layer, LayerHostHandle } from '.';
import { useActiveWindow } from '../hooks/useActiveWindow';
import { useMediaPlayers } from '../hooks/useMediaPlayers';
import { mediaMprisListPinnedAtom } from '../store/mediaMprisList';
import { ActiveWindowPanel } from './leftsideLayers/ActiveWindowPanel';
import { BrowserPanel } from './leftsideLayers/BrowserPanel';
import { KonsolePanel } from './leftsideLayers/KonsolePanel';
import { VlcPanel } from './leftsideLayers/VlcPanel';
import { DolphinPanel } from './leftsideLayers/DolphinPanel';
import { MediaMprisList } from './leftsideLayers/MediaMprisList';
import { keys } from '../services/keyInjector';
import { CiWavePulse1 } from 'react-icons/ci';
import { LuDock } from 'react-icons/lu';
import { BsWindowDock } from 'react-icons/bs';


// ── Media control ─────────────────────────────────────────────────────────────


const ICON_SIZE = 32;

type SplittedLeftLayerName = 'window' | 'browser' | 'konsole' | 'vlc' | 'dolphin' | 'mediaMprisList';

const BROWSER_CLASSES = [
  'firefox', 'firefox-esr',
  'google-chrome', 'google-chrome-stable', 'google-chrome-beta',
  'chromium', 'chromium-browser',
  'brave-browser', 'brave',
  'microsoft-edge', 'microsoft-edge-stable',
  'opera', 'opera-stable',
  'vivaldi-stable', 'vivaldi',
  'thorium-browser',
  'waterfox', 'librewolf', 'floorp',
];

function resolveLeftSideLayerByClass(activeClass: string): SplittedLeftLayerName {
  const cls = activeClass.toLowerCase();
  if (cls && BROWSER_CLASSES.some(b => cls.includes(b))) return 'browser';
  if (cls.includes('konsole')) return 'konsole';
  if (cls.includes('vlc')) return 'vlc';
  if (cls.includes('dolphin')) return 'dolphin';
  return 'window';
}

const SPLITTED_LEFT_LAYERS: Layer[] = [
  { name: 'window',  component: ActiveWindowPanel, animation: 'fade' },
  { name: 'browser', component: BrowserPanel,      animation: 'fade' },
  { name: 'konsole', component: KonsolePanel,      animation: 'fade' },
  { name: 'vlc',     component: VlcPanel,          animation: 'fade' },
  { name: 'dolphin', component: DolphinPanel,      animation: 'fade' },
  { name: 'mediaMprisList', component: MediaMprisList, animation: 'fade' },
];

interface RightBtn {
  key: string;
  icon: React.ReactElement;
  width: number;
  color: string;
  activeColor: string;
  onClick: () => void;
}

const BASE_BTNS: Omit<RightBtn, 'onClick'>[] = [
  { key: 'back',       icon: <FaChevronLeft style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />, width: 40 ,color:"#444444" , activeColor:"#555555"},
  { key: 'volume',     icon: <MdVolumeUp     style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />, width: 120 , color:"#444444" , activeColor:"#555555"},
  { key: 'brightness', icon: <MdWbSunny      style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />, width: 120 , color:"#444444" , activeColor:"#555555"},
  { key: 'linux',      icon: <CiWavePulse1        style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />, width: 120 , color:"#444444" , activeColor:"#555555"},
  { key: 'playpause',  icon: <BsWindowDock    style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />, width: 120 , color:"#444444" , activeColor:"#555555"},
  // { key: 'search',     icon: <MdSearch       style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />, width: 120 , color:"#444444" , activeColor:"#555555"},
];

const EQ_BAR_W = 4;
const EQ_BARS = [
  { h: 12, dur: 540, delay: 0   },
  { h: 24, dur: 700, delay: 120 },
  { h: 18, dur: 600, delay: 60  },
  { h: 28, dur: 480, delay: 180 },
];

function EqBar({ h, dur, delay, playing }: { h: number; dur: number; delay: number; playing: boolean }) {
  const op = useSpringValue(1);
  useEffect(() => {
    if (playing) {
      op.start({ to: 0.3, loop: { reverse: true }, config: { duration: dur }, delay });
    } else {
      op.stop();
      op.start({ to: 1, config: { duration: 200 } });
    }
    return () => { op.stop(); };
  }, [playing, op, dur, delay]);

  return <animated.Box style={{ width: EQ_BAR_W, height: h, opacity: op, backgroundColor: '#cccccc', borderRadius: 2 }} />;
}

function EqualizerIcon({ playing }: { playing: boolean }) {
  return (
    <Box style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 3, height: ICON_SIZE }}>
      {EQ_BARS.map((b, i) => <EqBar key={i} {...b} playing={playing} />)}
    </Box>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SplittedLayer({ width, height }: { width: number; height: number }) {
  const { go } = useLayers(); // outer context — navigates top-level layers
  const leftRef = useRef<LayerHostHandle>(null);
  const { class: activeClass } = useActiveWindow();
  const { show: showMedia, loading: mediaLoading, players } = useMediaPlayers();
  const [isMediaMprisListPinned, setIsMediaMprisListPinned] = useAtom(mediaMprisListPinnedAtom);
  const mediaPlaying = useMemo(() => players.some(p => p.state.status === 'Playing'), [players]);
  const mediaBtns: RightBtn[] = useMemo(() => {
    // Dispatch each button's action by its key, not its position, so reordering
    // BASE_BTNS can't silently wire a button to the wrong action.
    const actions: Record<string, () => void> = {
      back:       () => go('media', 'slide-left'),
      linux:      () => go('systembar', 'slide-up'),
      volume:     () => go('audio-slider', 'slide-up'),
      brightness: () => go('brightness-slider', 'slide-up'),
      playpause:  () => go('dock', 'slide-up'),
    };
    const base: RightBtn[] = BASE_BTNS.map(b => ({ ...b, onClick: actions[b.key] ?? (() => {}) }));
    if (showMedia) {
      base.splice(1, 0, {
        key: 'media',
        icon: <EqualizerIcon playing={mediaPlaying} />,
        width: 120,
        color: isMediaMprisListPinned ? '#333' : '#444444',
        activeColor: isMediaMprisListPinned ? '#444' : '#555555',
        // Just toggle the pin — the navigation effect below reacts to the
        // change and drives the left panel (no manual go() here, which would
        // fire the fade twice).
        onClick: () => setIsMediaMprisListPinned(p => !p),
      });
    }

    return base;
  }, [ showMedia, isMediaMprisListPinned, activeClass, mediaPlaying]);

  // Right panel width depends on the visible buttons + 2px gaps.
  const rightW = mediaBtns.reduce((sum, b) => sum + b.width, 0) + (mediaBtns.length - 1) * 2;
  const leftW = width - rightW - 20;

  const leftTargetRef = useRef<SplittedLeftLayerName | null>(null);
  useEffect(() => {
    // Pinned → stay on the list; otherwise resolve from the active window.
    const target = isMediaMprisListPinned
      ? 'mediaMprisList'
      : resolveLeftSideLayerByClass(activeClass);
    // Skip redundant navigation: while pinned the target stays put across
    // window changes, and two windows of the same kind resolve to one layer.
    if (target === leftTargetRef.current) return;
    leftTargetRef.current = target;
    leftRef.current?.go(target, 'fade');
  }, [activeClass, isMediaMprisListPinned]);

  useEffect(() => {
    if (mediaLoading) return;
    if (showMedia) return;
    if (!isMediaMprisListPinned) return;
    setIsMediaMprisListPinned(false);
  }, [showMedia, mediaLoading, isMediaMprisListPinned]);

  return (
    <Box style={{ justifyContent: 'space-between', flex: 1, gap: 20 }}>
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 2 ,flex:1  }}>
         <LayerHost
          ref={leftRef}
          width={leftW}
          height={height}
          initial="window"
          layers={SPLITTED_LEFT_LAYERS}
        /> 
      </Box>

        <Box
        style={{ flexDirection: 'row' ,gap:2}}
      >
        {mediaBtns.map((btn, idx) => (
          <Button
            key={btn.key}
            width={btn.width}
               color={ btn.color}
          activeColor={ btn.activeColor}
            onClick={btn.onClick}
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              borderTopLeftRadius: idx === 0 ? 10 : 0,
              borderBottomLeftRadius: idx === 0 ? 10 : 0,
              borderTopRightRadius: idx === mediaBtns.length - 1 ? 10 : 0,
              borderBottomRightRadius: idx === mediaBtns.length - 1 ? 10 : 0,
            }}
          >
            {btn.icon}
          </Button>
        ))}
      </Box>

    </Box>
  );
}
