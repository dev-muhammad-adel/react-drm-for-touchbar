import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, animated, motion, useSpringValue, KEY, Svg, easings } from 'react-drm';
import { useAtom, useSetAtom } from 'jotai';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa6';
import { MdVolumeUp, MdWbSunny, MdBrightness4, MdBrightness7, MdVolumeDown, MdApps, MdMicOff, MdSearch, MdSkipPrevious, MdPlayArrow, MdSkipNext, MdVolumeOff, MdCancel } from 'react-icons/md';
import { CiWavePulse1 } from 'react-icons/ci';
import { BsWindowDock } from 'react-icons/bs';
import { FaGrip } from 'react-icons/fa6';
import { useActiveWindow } from '@/lib/hooks/useActiveWindow';
import { useMediaPlayers } from '@/lib/hooks/useMediaPlayers';
import { mediaMprisListPinnedAtom } from '@/store/mediaMprisList';
import { useVolumeControl, readVolume, clampVolume } from '@/lib/hooks/useVolume';
import { useDisplayBrightnessControl, readBrightness, DISPLAY_DEVICE, TRACK_W as BRIGHTNESS_TRACK_W, clamp01 } from '@/lib/hooks/useBrightness';
import { audioTrackAnchorAtom, ANCHOR_TRACK_W } from '@/store/audioTrackAnchor';
import type { LayerConfig, LayoutChildren } from '@/lib/routes/loadRoutes';
import { DEFAULT_CHILD_NAME } from '@/lib/routes/loadRoutes';
import { go, routerAt } from '@/lib/routes/router-registry';
import { CUSTOM_LAYER } from '@/lib/utils/configLoader';
import { SELECTED_THEME } from '@/lib/theme';
import { keys } from '@/lib/services/keyInjector';
import path, { relative } from 'path';

// How splitted itself transitions within the root layer host.
export const layerConfig: LayerConfig = {
  leaving:  { outAnim: 'fade' },
  entering: { inAnim:  'fade' },
};

// Its own children's default (app/splitted/page.tsx, named DEFAULT_CHILD_NAME)
// picks itself automatically — no layoutConfig needed here anymore.

type SplittedLeftLayerName = typeof DEFAULT_CHILD_NAME | 'browser' | 'konsole' | 'vlc' | 'dolphin' | 'vscode' | 'gwenview' | 'mediaMprisList';

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
  return DEFAULT_CHILD_NAME;
}

// ── Media control ─────────────────────────────────────────────────────────────

const ICON_SIZE = 32;

// app/splitted/layout.tsx sits two levels under its own root in both trees
// (linux-touchbar-control-center/app/splitted in dev, dist/app/splitted once
// built, with assets/ copied alongside dist/ at build time) — same relative
// depth either way, so one formula covers both instead of a dev/built branch.
const KBD_ILLUM_DOWN_ICON = path.join(__dirname, '..', '..', 'assets', 'kbd_illum_down.svg');
const KBD_ILLUM_UP_ICON   = path.join(__dirname, '..', '..', 'assets', 'kbd_illum_up.svg');

// The four tool groups reused from /app/media/page.tsx, rendered inline when
// the right cluster expands — same look, but as an in-place expanding panel
// rather than a full-screen page swap.
function MediaToolBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      color={SELECTED_THEME.surface}
      activeColor={SELECTED_THEME.surfaceVariant}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderColor: SELECTED_THEME.border, borderWidth: SELECTED_THEME.borderWidth }}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

// All the /app/media/page tool buttons, rendered inline with the same surface
// (bordered rounded tiles, grouped by flexGrow exactly like the media page)
// when the right cluster expands — same buttons and same look, as an in-place
// expanding panel rather than a page swap.
function MediaToolPanel({ iconSize  }: { iconSize: number  }) {
  const icon = (node: React.ReactNode) => <Box style={{ width: iconSize, height: iconSize, alignItems: 'center', justifyContent: 'center' }}>{node}</Box>;
  return (
    <Box style={{ flex: 1, gap: 30 ,backgroundColor:"#000" }}>
      <Box style={{ flexGrow: 2, gap: 6 }}>
        <MediaToolBtn onClick={() => keys.pressKey(KEY.BRIGHTNESSDOWN)}>{icon(<MdBrightness4 style={{ width: iconSize, height: iconSize }} fill={SELECTED_THEME.textPrimary} stroke="none" />)}</MediaToolBtn>
        <MediaToolBtn onClick={() => keys.pressKey(KEY.BRIGHTNESSUP)}>{icon(<MdBrightness7 style={{ width: iconSize, height: iconSize }} fill={SELECTED_THEME.textPrimary} stroke="none" />)}</MediaToolBtn>
      </Box>
      <Box style={{ flexGrow: 1 }}>
        <MediaToolBtn onClick={() => keys.pressKey(KEY.MICMUTE)}>{icon(<MdMicOff style={{ width: iconSize, height: iconSize }} fill={SELECTED_THEME.textPrimary} stroke="none" />)}</MediaToolBtn>
      </Box>
      <Box style={{ flexGrow: 1 }}>
        <MediaToolBtn onClick={() => keys.pressKey(KEY.SEARCH)}>{icon(<MdSearch style={{ width: iconSize, height: iconSize }} fill={SELECTED_THEME.textPrimary} stroke="none" />)}</MediaToolBtn>
      </Box>
      <Box style={{ flexGrow: 2, gap: 6 }}>
        <MediaToolBtn onClick={() => keys.pressKey(KEY.KBDILLUMDOWN)}>{icon(<Svg src={KBD_ILLUM_DOWN_ICON} width={iconSize} height={iconSize} />)}</MediaToolBtn>
        <MediaToolBtn onClick={() => keys.pressKey(KEY.KBDILLUMUP)}>{icon(<Svg src={KBD_ILLUM_UP_ICON} width={iconSize} height={iconSize} />)}</MediaToolBtn>
      </Box>
      <Box style={{ flexGrow: 3, gap: 6 }}>
        <MediaToolBtn onClick={() => keys.pressKey(KEY.PREVIOUSSONG)}>{icon(<MdSkipPrevious style={{ width: iconSize, height: iconSize }} fill={SELECTED_THEME.textPrimary} stroke="none" />)}</MediaToolBtn>
        <MediaToolBtn onClick={() => keys.pressKey(KEY.PLAYPAUSE)}>{icon(<MdPlayArrow style={{ width: iconSize, height: iconSize }} fill={SELECTED_THEME.textPrimary} stroke="none" />)}</MediaToolBtn>
        <MediaToolBtn onClick={() => keys.pressKey(KEY.NEXTSONG)}>{icon(<MdSkipNext style={{ width: iconSize, height: iconSize }} fill={SELECTED_THEME.textPrimary} stroke="none" />)}</MediaToolBtn>
      </Box>
      <Box style={{ flexGrow: 3, gap: 6 }}>
        <MediaToolBtn onClick={() => keys.pressKey(KEY.MUTE)}>{icon(<MdVolumeOff style={{ width: iconSize, height: iconSize }} fill={SELECTED_THEME.textPrimary} stroke="none" />)}</MediaToolBtn>
        <MediaToolBtn onClick={() => keys.pressKey(KEY.VOLUMEDOWN)}>{icon(<MdVolumeDown style={{ width: iconSize, height: iconSize }} fill={SELECTED_THEME.textPrimary} stroke="none" />)}</MediaToolBtn>
        <MediaToolBtn onClick={() => keys.pressKey(KEY.VOLUMEUP)}>{icon(<MdVolumeUp style={{ width: iconSize, height: iconSize }} fill={SELECTED_THEME.textPrimary} stroke="none" />)}</MediaToolBtn>
      </Box>
      
    </Box>
  );
}

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

/** Thin vertical divider between collapsed cluster buttons. */
function Separator() {
  return <Box style={{ width: SELECTED_THEME.borderWidth, backgroundColor: SELECTED_THEME.border }} />;
}

/** A single collapsed-cluster button, with selectable rounded corners. */
function ClusterBtn({ btn, leftRound, rightRound , width }: {width?:number; btn: RightBtn; leftRound?: boolean; rightRound?: boolean }) {
  return (
    <Button
      width={width}
      color={btn.color}
      activeColor={btn.activeColor}
      onClick={btn.onClick}
      onLongPress={btn.onLongPress}
      onTouchStart={btn.onTouchStart}
      onTouchMove={btn.onTouchMove}
      onTouchEnd={btn.onTouchEnd}
      style={{
        flexGrow:width?undefined:1,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {btn.icon}
    </Button>
  );
}

const BASE_BTNS: Omit<RightBtn, 'onClick'>[] = [
  { key: 'back',       icon: <FaChevronLeft style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />, width: 40 ,color:SELECTED_THEME.surface , activeColor:SELECTED_THEME.surfaceVariant},
  { key: 'volume',     icon: <MdVolumeUp     style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />, width: 120 , color:SELECTED_THEME.surface , activeColor:SELECTED_THEME.surfaceVariant},
  { key: 'brightness', icon: <MdWbSunny      style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />, width: 120 , color:SELECTED_THEME.surface , activeColor:SELECTED_THEME.surfaceVariant},
  { key: 'linux',      icon: <CiWavePulse1        style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />, width: 120 , color:SELECTED_THEME.surface , activeColor:SELECTED_THEME.surfaceVariant},
  { key: 'playpause',  icon: <BsWindowDock    style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />, width: 120 , color:SELECTED_THEME.surface , activeColor:SELECTED_THEME.surfaceVariant},
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

  return <animated.Box style={{ width: EQ_BAR_W, height: h, opacity: op, backgroundColor: SELECTED_THEME.textPrimary, borderRadius: 2 }} />;
}

function EqualizerIcon({ playing }: { playing: boolean }) {
  return (
    <Box style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 3, height: ICON_SIZE }}>
      {EQ_BARS.map((b, i) => <EqBar key={i} {...b} playing={playing} />)}
    </Box>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SplittedLayout({ width, height, children, path }: {
  width:    number;
  height:   number;
  children: LayoutChildren; // renders app/splitted/*/page.tsx's active child
  path:     string;         // 'splitted' — for addressing its own children
}) {
  const { class: activeClass } = useActiveWindow();
  const { show: showMedia, loading: mediaLoading, players } = useMediaPlayers();
  const [isMediaMprisListPinned, setIsMediaMprisListPinned] = useAtom(mediaMprisListPinnedAtom);
  const mediaPlaying = useMemo(() => players.some(p => p.state.status === 'Playing'), [players]);
  const { setVolume, syncVolume } = useVolumeControl();
  const { setBrightness } = useDisplayBrightnessControl();
  const setAudioTrackAnchor = useSetAtom(audioTrackAnchorAtom);
  const [isAnimating,setIsAnimating] = useState(false)
  // Long-press-and-drag on the volume/brightness buttons: the touch never
  // leaves the button's registered gesture (layer swaps don't retarget an
  // in-progress touch), so the whole hold-then-slide-left/right gesture is
  // driven from here even after the corresponding slider layer is on screen.
  const volDragRef = useRef<{ x: number; v: number } | null>(null);
  const volTouchXRef = useRef(0);
  const brightDragRef = useRef<{ x: number; v: number } | null>(null);
  const brightTouchXRef = useRef(0);
  const [mediaExpanded, setMediaExpanded] = useState(false);
  const mediaBtns: RightBtn[] = useMemo(() => {
    // Dispatch each button's action by its key, not its position, so reordering
    // BASE_BTNS can't silently wire a button to the wrong action.
    const actions: Record<string, () => void> = {
      back:       () => setMediaExpanded(e => !e),
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
        color: isMediaMprisListPinned ? SELECTED_THEME.overlay : SELECTED_THEME.surface,
        activeColor: isMediaMprisListPinned ? SELECTED_THEME.surfaceVariant : SELECTED_THEME.surfaceVariant,
        // Just toggle the pin — the navigation effect below reacts to the
        // change and drives the left panel (no manual go() here, which would
        // fire the fade twice).
        onClick: () => setIsMediaMprisListPinned(p => !p),
      });
    }
    if (CUSTOM_LAYER.showButton) {
      base.push({
        key: 'customlayer',
        icon: <FaGrip style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />,
        width: 50,
        color: SELECTED_THEME.surface,
        activeColor: SELECTED_THEME.surfaceVariant,
        onClick: () => go('custom-layer', 'slide-up'),
      });
    }

    return base;
  }, [ showMedia, isMediaMprisListPinned, activeClass, mediaPlaying]);

  // Right panel width depends on the visible buttons + 3px gaps. When the media
  // tools are expanded it springs out to fill whatever the left panel leaves.
  const wrapperPad = SELECTED_THEME.borderWidth;
  const rightW = wrapperPad * 2 + mediaBtns.reduce((sum, b) => sum + b.width, 0) + (mediaBtns.length - 1) * 2;
  const leftW = width - rightW - 20;


  const leftTargetRef = useRef<SplittedLeftLayerName | null>(null);
  useEffect(() => {
    // Pinned → stay on the list; otherwise resolve from the active window.
    const target = isMediaMprisListPinned
      ? 'mediaMprisList'
      : resolveLeftSideLayerByClass(activeClass);

    // When the media panel finished animating back (isAnimating → false) the
    // routed left host may have swapped layers behind `children(leftW, height)`
    // while it was hidden behind the expanded panel — `leftTargetRef` still
    // matches the intended target, so the guard below would skip navigating.
    // Reconcile against the host's LIVE current layer: if it drifted from the
    // target, steer it back. Deferred a tick so the sibling RouteBranch's
    // re-registration effect (which runs after ours) has re-registered the
    // fresh host first.
    if (target === leftTargetRef.current && !isAnimating) {
      const t = setTimeout(() => {
        const current = routerAt(path)?.current;
        if (current && current !== target) go(`${path}/${target}`, 'fade');
      }, 0);
      return () => clearTimeout(t);
    }
    // Skip redundant navigation: while pinned the target stays put across
    // window changes, and two windows of the same kind resolve to one layer.
    if (target === leftTargetRef.current) return;
    leftTargetRef.current = target;
    // go() queues this until the target actually mounts if it hasn't yet
    // (e.g. this very first run, before splitted's own nested host has
    // registered itself) — no need to wait for it here ourselves.
    go(`${path}/${target}`, 'fade');
  }, [activeClass, isMediaMprisListPinned, path, isAnimating]);

  useEffect(() => {
    if (mediaLoading) return;
    if (showMedia) return;
    if (!isMediaMprisListPinned) return;
    setIsMediaMprisListPinned(false);
  }, [showMedia, mediaLoading, isMediaMprisListPinned]);


  const btnByKey = (key: string) => mediaBtns.find(b => b.key === key);

  return (
    <Box style={{ justifyContent: 'space-between', flex: 1, gap: mediaExpanded ? 0 : 0 }}>
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 2 ,flex:1  }}>
        {children(leftW, height)}
      </Box>

        <Box
        style={{ overflow: 'hidden',
            flexDirection: 'row', 
             width: mediaExpanded ? width  :width/1.7,
              justifyContent: 'flex-end'
            }}
      >
           <motion.Box
          initial={{width:0}}
           animate={{ width: mediaExpanded ? [0,(width/1.7),width]  :[ 0 ]  }} 
        transition={{ duration: [150,mediaExpanded?150:0,150] }}
          style={{   backgroundColor:"#000" , height:height , position:"absolute" , right: 2  ,top:0,zIndex:-1

          }}>
            <Button
              width={40}
              color={"#000"}
              activeColor={"#000"}
              onClick={() => setMediaExpanded(false)}
              style={{marginHorizontal:20, alignItems: 'center', justifyContent: 'center', borderTopLeftRadius: 10, borderBottomLeftRadius: 10 }}
            >
              <MdCancel style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />
            </Button>
            <MediaToolPanel  iconSize={30} />
          </motion.Box>  



          
         {  <motion.Box
        
        initial={{width:rightW , opacity:1}}
        animate={{
           width:mediaExpanded? [width/1.7, 120 , width/1.7] : [rightW],
           opacity:mediaExpanded? [0.1, 0] : [1],
        }}
        
        animateOnMount={false}
        transition={[
          { tension: 400, friction: 28 },
          { tension: 400, friction: 28 },
          { duration: 0 },
        ]}
        onAnimationStart={() => setIsAnimating(true)}
         onAnimationComplete={() => setIsAnimating(false)}

        style={{ 
          borderWidth:SELECTED_THEME.borderWidth,
          padding:SELECTED_THEME.borderWidth,
          borderRadius:10,
          borderColor:SELECTED_THEME.border,
          
          overflow:"hidden",
          flexDirection: 'row' ,
          justifyContent:"flex-end",
            // display:!isAnimating&&mediaExpanded? "none":undefined ,
             backgroundColor:SELECTED_THEME.surface,
             ...(mediaExpanded&&!isAnimating?{zIndex:-10,
          position:"absolute",
          height,
          right:2,}:{})
             
             }}>
           {<ClusterBtn width={40} btn={btnByKey('back')!} leftRound />}
            <Separator />
            <ClusterBtn btn={btnByKey('volume')!} />
            <Separator />
            <ClusterBtn btn={btnByKey('brightness')!} />
            <Separator />
            <ClusterBtn btn={btnByKey('linux')!} />
            <Separator />
            <ClusterBtn btn={btnByKey('playpause')!} width={mediaExpanded?120:undefined} rightRound={mediaBtns.length === 5} />
            {btnByKey('media') && (
              <>
                <Separator />
                <ClusterBtn btn={btnByKey('media')!} rightRound={mediaBtns.length === 6} />
              </>
            )}
            {btnByKey('customlayer') && (
              <>
                <Separator />
                <ClusterBtn btn={btnByKey('customlayer')!} rightRound />
              </>
            )}
          </motion.Box>} 
      </Box>

    </Box>
  );
}
