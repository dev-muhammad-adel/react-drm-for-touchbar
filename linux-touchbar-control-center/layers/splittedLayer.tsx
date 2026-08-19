import React, { useEffect, useMemo, useRef } from 'react';
import { Box, Button, KEY, animated, useSpringValue } from 'react-drm';
import { useAtom, useSetAtom } from 'jotai';
import { FaChevronLeft, FaLinux } from 'react-icons/fa6';
import { MdPlayArrow, MdVolumeUp, MdWbSunny, MdSearch, MdMusicNote } from 'react-icons/md';
import { LayerHost, useLayers } from '.';
import type { Layer, LayerHostHandle } from '.';
import { useActiveWindow } from '@/lib/hooks/useActiveWindow';
import { useMediaPlayers } from '@/lib/hooks/useMediaPlayers';
import { mediaMprisListPinnedAtom } from '@/store/mediaMprisList';
import { useVolumeControl, readVolume, clampVolume } from '@/lib/hooks/useVolume';
import { useDisplayBrightnessControl, readBrightness, DISPLAY_DEVICE, TRACK_W as BRIGHTNESS_TRACK_W, clamp01 } from '@/lib/hooks/useBrightness';
import { audioTrackAnchorAtom, ANCHOR_TRACK_W } from '@/store/audioTrackAnchor';
import { ActiveWindowPanel } from './leftsideLayers/ActiveWindowPanel';
import { BrowserPanel } from './leftsideLayers/BrowserPanel';
import { KonsolePanel } from './leftsideLayers/KonsolePanel';
import { VlcPanel } from './leftsideLayers/VlcPanel';
import { DolphinPanel } from './leftsideLayers/DolphinPanel';
import { VsCodePanel } from './leftsideLayers/VsCodePanel';
import { GwenviewPanel } from './leftsideLayers/GwenviewPanel';
import { MediaMprisList } from './leftsideLayers/MediaMprisList';
import { keys } from '@/lib/services/keyInjector';
import { CiWavePulse1 } from 'react-icons/ci';
import { LuDock } from 'react-icons/lu';
import { BsWindowDock } from 'react-icons/bs';


// ── Media control ─────────────────────────────────────────────────────────────


const ICON_SIZE = 32;

type SplittedLeftLayerName = 'window' | 'browser' | 'konsole' | 'vlc' | 'dolphin' | 'vscode' | 'gwenview' | 'mediaMprisList';

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

// Matches VS Code's own DOCK.apps entry (config.ts) — 'code' covers both the
// stable and Insiders Linux packages, 'code-oss' the distro-packaged open
// source build.
const CODE_CLASSES = ['code', 'code-oss', 'codium', 'vscodium'];

function resolveLeftSideLayerByClass(activeClass: string): SplittedLeftLayerName {
  const cls = activeClass.toLowerCase();
  if (cls && BROWSER_CLASSES.some(b => cls.includes(b))) return 'browser';
  if (cls.includes('konsole')) return 'konsole';
  if (cls.includes('vlc')) return 'vlc';
  if (cls.includes('dolphin')) return 'dolphin';
  if (cls.includes('gwenview')) return 'gwenview';
  if (cls && CODE_CLASSES.some(c => cls.includes(c))) return 'vscode';
  return 'window';
}

const SPLITTED_LEFT_LAYERS: Layer[] = [
  { name: 'window',  component: ActiveWindowPanel, animation: 'fade' },
  { name: 'browser', component: BrowserPanel,      animation: 'fade' },
  { name: 'konsole', component: KonsolePanel,      animation: 'fade' },
  { name: 'vlc',     component: VlcPanel,          animation: 'fade' },
  { name: 'dolphin', component: DolphinPanel,      animation: 'fade' },
  { name: 'vscode',  component: VsCodePanel,       animation: 'fade' },
  { name: 'gwenview', component: GwenviewPanel,    animation: 'fade' },
  { name: 'mediaMprisList', component: MediaMprisList, animation: 'fade' },
];

interface RightBtn {
  key: string;
  icon: React.ReactElement;
  width: number;
  color: string;
  activeColor: string;
  onClick: () => void;
  onLongPress?: () => void;
  onTouchStart?: (x: number, y: number) => void;
  onTouchMove?: (x: number, y: number) => void;
  onTouchEnd?: (x: number, y: number) => void;
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
  const { setVolume, syncVolume } = useVolumeControl();
  const { setBrightness } = useDisplayBrightnessControl();
  const setAudioTrackAnchor = useSetAtom(audioTrackAnchorAtom);
  // Long-press-and-drag on the volume/brightness buttons: the touch never
  // leaves the button's registered gesture (layer swaps don't retarget an
  // in-progress touch), so the whole hold-then-slide-left/right gesture is
  // driven from here even after the corresponding slider layer is on screen.
  const volDragRef = useRef<{ x: number; v: number } | null>(null);
  const volTouchXRef = useRef(0);
  const brightDragRef = useRef<{ x: number; v: number } | null>(null);
  const brightTouchXRef = useRef(0);
  const mediaBtns: RightBtn[] = useMemo(() => {
    // Dispatch each button's action by its key, not its position, so reordering
    // BASE_BTNS can't silently wire a button to the wrong action.
    const actions: Record<string, () => void> = {
      back:       () => go('media', 'slide-left'),
      linux:      () => go('systembar', 'slide-up'),
      volume:     () => { setAudioTrackAnchor(null); go('audio-slider', 'fade'); },
      brightness: () => go('brightness-slider', 'fade'),
      playpause:  () => go('dock', 'slide-up'),
    };
    const base: RightBtn[] = BASE_BTNS.map(b => ({ ...b, onClick: actions[b.key] ?? (() => {}) }));
    const volumeBtn = base.find(b => b.key === 'volume');
    if (volumeBtn) {
      // Enters the anchored live-drag: reads the current volume, anchors the
      // track to the touch point, and switches to audio-slider near-instantly
      // (a live drag can't wait out a leisurely fade — every touchmove that
      // lands during a slow transition updates volume on a layer that isn't
      // visible yet, so the drag's start goes unseen). Called from onLongPress
      // (finger held still) and, faster, from onTouchMove the moment real drag
      // intent is detected — whichever happens first.
      const enterVolumeDrag = (touchX: number) => {
        const startVol = readVolume();
        volDragRef.current = { x: touchX, v: startVol };
        // The shared volume atom only refreshes on live pactl events while
        // AudioSliderLayer is mounted — if volume changed externally while
        // it wasn't (e.g. a hardware key), the atom can be stale here. Sync
        // it to the freshly-read value so SliderTrack's fill (which drives
        // where the knob actually renders) agrees with the anchor math below
        // — otherwise the knob lands wherever the stale fill puts it, not on
        // the touch point.
        syncVolume(startVol);
        // Anchor the track so its knob (at fill*ANCHOR_TRACK_W along the
        // track) lands exactly on the touch point: trackLeft = touchX -
        // vol*ANCHOR_TRACK_W. Set once — stays correct for the whole drag
        // since the knob's own fill-driven position already absorbs the
        // finger's movement. Sensitivity here must match ANCHOR_TRACK_W (not
        // the default TRACK_W) since that's the width the anchored track
        // actually renders at.
        // 5.5 is half of the inset safe x of pixel shifting
        setAudioTrackAnchor({ x: touchX -( startVol * ANCHOR_TRACK_W )-5.5});
        go('audio-slider', {
          fromLayerSwitch: { outAnim: 'fade', duration: 5 },
          toLayerSwitch:   { inAnim: 'fade', duration: 500, showAfter: 0 },
        });
      };

      volumeBtn.onTouchStart = (x) => { volTouchXRef.current = x; };
      volumeBtn.onLongPress = () => {
        if (volDragRef.current) return; // already entered via an early drag-move
        enterVolumeDrag(volTouchXRef.current);
      };
      volumeBtn.onTouchMove = (x) => {
        if (!volDragRef.current) {
          // Finger started moving before the long-press timer fired — real
          // drag intent doesn't wait; enter as soon as it's past tap jitter.
          if (Math.abs(x - volTouchXRef.current) < 8) return;
          enterVolumeDrag(volTouchXRef.current);
        }
        const nv = clampVolume(volDragRef.current!.v + (x - volDragRef.current!.x) / ANCHOR_TRACK_W);
        setVolume(nv);
        volDragRef.current = { x, v: nv };
      };
      volumeBtn.onTouchEnd = () => { volDragRef.current = null; };
    }
    const brightnessBtn = base.find(b => b.key === 'brightness');
    if (brightnessBtn) {
      // See enterVolumeDrag above — same reasoning: a live drag can't wait out
      // a leisurely transition, so switch fast and let onTouchMove trigger
      // this itself the moment real drag intent is detected, not just onLongPress.
      const enterBrightnessDrag = (touchX: number) => {
        brightDragRef.current = { x: touchX, v: readBrightness(DISPLAY_DEVICE) };
        go('brightness-slider', {
          fromLayerSwitch: { outAnim: 'slide-up', duration: 100 },
          toLayerSwitch:   { inAnim: 'slide-up', duration: 100, showAfter: 0 },
        });
      };

      brightnessBtn.onTouchStart = (x) => { brightTouchXRef.current = x; };
      brightnessBtn.onLongPress = () => {
        if (brightDragRef.current) return; // already entered via an early drag-move
        enterBrightnessDrag(brightTouchXRef.current);
      };
      brightnessBtn.onTouchMove = (x) => {
        if (!brightDragRef.current) {
          if (Math.abs(x - brightTouchXRef.current) < 8) return; // still just tap jitter
          enterBrightnessDrag(brightTouchXRef.current);
        }
        const nv = clamp01(brightDragRef.current!.v + (x - brightDragRef.current!.x) / BRIGHTNESS_TRACK_W);
        setBrightness(nv);
        brightDragRef.current = { x, v: nv };
      };
      brightnessBtn.onTouchEnd = () => { brightDragRef.current = null; };
    }
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
            onLongPress={btn.onLongPress}
            onTouchStart={btn.onTouchStart}
            onTouchMove={btn.onTouchMove}
            onTouchEnd={btn.onTouchEnd}
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
