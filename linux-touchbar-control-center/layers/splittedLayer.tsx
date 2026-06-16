import React, { useEffect, useRef } from 'react';
import { execFile } from 'child_process';
import { Box, Text, Button } from 'react-drm';
import { FaChevronLeft, FaLinux } from 'react-icons/fa6';
import { MdPlayArrow, MdVolumeUp, MdWbSunny, MdSportsEsports } from 'react-icons/md';
import { LayerHost, useLayers } from '.';
import type { Layer, LayerHostHandle } from '.';
import { useActiveWindow } from '../hooks/useActiveWindow';
import { ActiveWindowPanel } from './leftsideLayers/ActiveWindowPanel';
import { BrowserPanel } from './leftsideLayers/FirefoxPanel';
import { KonsolePanel } from './leftsideLayers/KonsolePanel';
import { VlcPanel } from './leftsideLayers/VlcPanel';
import { DolphinPanel } from './leftsideLayers/DolphinPanel';


// ── Media control ─────────────────────────────────────────────────────────────

type MediaCmd = 'previous' | 'play-pause' | 'next';

function playerctl(cmd: MediaCmd): void {
  execFile('playerctl', [cmd], () => {});
}

const ICON_SIZE = 32;

type SplittedLeftLayerName = 'window' | 'browser' | 'konsole' | 'vlc' | 'dolphin';

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
];

const MEDIA_BTNS: { icon: React.ReactElement; cmd?: MediaCmd; width: number; color: string; activeColor: string }[] = [
  { icon: <FaChevronLeft style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />, width: 40 ,color:"#4f4b4f" , activeColor:"#666666"},
  { icon: <FaLinux        style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />, width: 130 , color:"#4f4b4f" , activeColor:"#666666"},
  { icon: <MdVolumeUp     style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />, width: 130 , color:"#4f4b4f" , activeColor:"#666666"},
  { icon: <MdWbSunny      style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />, width: 130 , color:"#4f4b4f" , activeColor:"#666666"},
  { icon: <MdPlayArrow     style={{ width: ICON_SIZE, height: ICON_SIZE }} fill="#cccccc" stroke="none" />, cmd: 'play-pause', width: 100 , color:"#4f4b4f" , activeColor:"#666666"},
];

// ── Component ─────────────────────────────────────────────────────────────────

// Right panel width: 5 buttons (40+130+130+130+100) + 4×2px gaps
const RIGHT_W =MEDIA_BTNS.reduce((sum, b) => sum + b.width, 0) + (MEDIA_BTNS.length - 1) * 2;
const NAV_W   = 28;

export function SplittedLayer({ width, height }: { width: number; height: number }) {
  const { go } = useLayers(); // outer context — navigates top-level layers
  const leftRef = useRef<LayerHostHandle>(null);
  const { class: activeClass } = useActiveWindow();
  const leftW = width - RIGHT_W - 20 ; 

  useEffect(() => {
    const target = resolveLeftSideLayerByClass(activeClass);
    console.log('Active window class:', activeClass, '→ showing layer:', target);
    leftRef.current?.go(target, 'fade');
  }, [activeClass]);

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
        {MEDIA_BTNS.map((btn, idx) => (
          <Button
            key={`${btn.cmd}-${idx}`}
            width={btn.width}
               color={ btn.color}
          activeColor={ btn.activeColor}

            onClick={
              idx === 0 ? () => go('media', 'slide-left') :
              idx === 1 ? () => go('systembar', 'slide-up') :
              idx === 2 ? () => go('audio-slider', 'slide-up') :
              idx === 3 ? () => go('brightness-slider', 'slide-up') :
              () => playerctl(btn.cmd as MediaCmd)
            }
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              borderTopLeftRadius: idx === 0 ? 10 : 0,
              borderBottomLeftRadius: idx === 0 ? 10 : 0,
              borderTopRightRadius: idx === MEDIA_BTNS.length - 1 ? 10 : 0,
              borderBottomRightRadius: idx === MEDIA_BTNS.length - 1 ? 10 : 0,
            }}
          >
            {btn.icon}
          </Button>
        ))}
      </Box>

    </Box>
  );
}
