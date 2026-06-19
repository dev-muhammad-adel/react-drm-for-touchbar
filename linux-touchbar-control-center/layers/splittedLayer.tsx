import React, { useEffect, useMemo, useRef } from 'react';
import { Box, Button, KEY } from 'react-drm';
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
  { key: 'back',       icon: <FaChevronLeft style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />, width: 40 ,color:"#4f4b4f" , activeColor:"#666666"},
  { key: 'linux',      icon: <FaLinux        style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />, width: 120 , color:"#4f4b4f" , activeColor:"#666666"},
  { key: 'volume',     icon: <MdVolumeUp     style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />, width: 120 , color:"#4f4b4f" , activeColor:"#666666"},
  { key: 'brightness', icon: <MdWbSunny      style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />, width: 120 , color:"#4f4b4f" , activeColor:"#666666"},
  { key: 'playpause',  icon: <MdPlayArrow    style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />, width: 120 , color:"#4f4b4f" , activeColor:"#666666"},
  { key: 'search',     icon: <MdSearch       style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />, width: 120 , color:"#4f4b4f" , activeColor:"#666666"},
];

// ── Component ─────────────────────────────────────────────────────────────────

export function SplittedLayer({ width, height }: { width: number; height: number }) {
  const { go } = useLayers(); // outer context — navigates top-level layers
  const leftRef = useRef<LayerHostHandle>(null);
  const { class: activeClass } = useActiveWindow();
  const { show: showMedia, loading: mediaLoading } = useMediaPlayers();
  const [isMediaMprisListPinned, setIsMediaMprisListPinned] = useAtom(mediaMprisListPinnedAtom);
  const mediaBtns: RightBtn[] = useMemo(() => {
    const base: RightBtn[] = [
      { ...BASE_BTNS[0], onClick: () => go('media', 'slide-left') },
      { ...BASE_BTNS[1], onClick: () => go('systembar', 'slide-up') },
      { ...BASE_BTNS[2], onClick: () => go('audio-slider', 'slide-up') },
      { ...BASE_BTNS[3], onClick: () => go('brightness-slider', 'slide-up') },
      { ...BASE_BTNS[4], onClick: () => keys.pressKey(KEY.PLAYPAUSE) },
      { ...BASE_BTNS[5], onClick: () => keys.pressKey(KEY.SEARCH) },
    ];
    if (showMedia) {
      base.splice(1, 0, {
        key: 'media',
        icon: <MdMusicNote style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />,
        width: 120,
        color: isMediaMprisListPinned ? '#2d5a3d' : '#4f4b4f',
        activeColor: isMediaMprisListPinned ? '#3d7a52' : '#666666',
        onClick: () => {
          if (isMediaMprisListPinned) {
            setIsMediaMprisListPinned(false);
            const target = resolveLeftSideLayerByClass(activeClass);
            leftRef.current?.go(target, 'fade');
          } else {
            setIsMediaMprisListPinned(true);
            leftRef.current?.go('mediaMprisList', 'fade');
          }
        },
      });
    }

    return base;
  }, [ showMedia, isMediaMprisListPinned, activeClass]);

  // Right panel width depends on the visible buttons + 2px gaps.
  const rightW = mediaBtns.reduce((sum, b) => sum + b.width, 0) + (mediaBtns.length - 1) * 2;
  const leftW = width - rightW - 20;

  useEffect(() => {
    console.log('SplittedLayer: activeClass', activeClass, 'isMediaMprisListPinned', isMediaMprisListPinned);
    if (isMediaMprisListPinned) {
 leftRef.current?.go('mediaMprisList', 'fade');
    }else{

      const target = resolveLeftSideLayerByClass(activeClass);
      leftRef.current?.go(target, 'fade');
    }
  }, [activeClass, isMediaMprisListPinned]);

  useEffect(() => {
    console.log({ showMedia, mediaLoading, isMediaMprisListPinned });
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
