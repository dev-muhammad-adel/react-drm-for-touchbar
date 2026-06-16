import React from 'react';
import path from 'path';
import { Box, Gif, animated, useSpringValue } from 'react-drm';
import type { KeyboardReader } from 'react-drm';
import { LayerHost } from './layers';

import { ESC_KEY, DOCK, FN_LAYER } from './config';
import { EscKey } from './components/EscKey';
import { SafeArea } from './components/SafeArea';
import { BootScreen } from './components/BootScreen';
import { SplittedLayer } from './layers/splittedLayer';
import { MediaScreen } from './layers/mediaScreen';
import { FnKeys } from './layers/fnKeys';
import { SystemBar } from './layers/systemBar';
import { AudioSliderLayer } from './layers/audioSlider';
import { BrightnessSliderLayer } from './layers/brightnessSlider';
import { GamesLayer } from './layers/gamesLayer';
import { DockLayer } from './layers/dock';
import { DinoLayer } from './layers/dino';
import { PongLayer } from './layers/pong';
import { useBootSequence } from './hooks/useBootSequence';
import { usePomodoroEngine } from './hooks/usePomodoro';

function PaintOnlyProfileScene({ width, height }: { width: number; height: number }) {
  const pulse = useSpringValue(0);
  React.useEffect(() => {
    pulse.start({ from: 0, to: 1, loop: { reverse: true }, config: { duration: 850 } });
  }, [pulse]);

  const barW = Math.max(360, Math.round(width * 0.84));
  const chipW = Math.max(110, Math.round(width * 0.13));

  return (
    <Box style={{ width, height, justifyContent: 'center', alignItems: 'center', backgroundColor: '#060a12', gap: 8 }}>
      <animated.Box style={{
        width: barW,
        height: 12,
        borderRadius: 6,
        opacity: pulse.to(v => 0.3 + (v * 0.65)),
        backgroundColor: pulse.to(v => `rgba(56, 189, 248, ${(0.1 + (v * 0.75)).toFixed(3)})`),
      }} />
      <Box style={{ width: barW, height: 12, flexDirection: 'row', justifyContent: 'space-between' }}>
        <animated.Box style={{
          width: chipW,
          height: 12,
          borderRadius: 6,
          opacity: pulse.to(v => 0.2 + (v * 0.6)),
          backgroundColor: pulse.to(v => `rgba(125, 211, 252, ${(0.08 + (v * 0.55)).toFixed(3)})`),
        }} />
        <animated.Box style={{
          width: chipW,
          height: 12,
          borderRadius: 6,
          opacity: pulse.to(v => 0.5 + ((1 - v) * 0.4)),
          backgroundColor: pulse.to(v => `rgba(16, 185, 129, ${(0.06 + ((1 - v) * 0.5)).toFixed(3)})`),
        }} />
      </Box>
    </Box>
  );
}

export function App({ width, height, keyboard }: { width: number; height: number; keyboard: KeyboardReader }) {
  if (process.env.REACT_DRM_PROFILE_SCENE === 'paint-only') {
    return <PaintOnlyProfileScene width={width} height={height} />;
  }

  const { booted, opacity } = useBootSequence();

  usePomodoroEngine();

  // if (!booted) return <BootScreen width={width} height={height} opacity={opacity} />;

  // Manual <Gif> test. The asset is 75×56; keep aspect ratio at the bar height.
  // if (!booted) return (<Box style={{ width, height, backgroundColor: '#000',  justifyContent: 'center' }}> 
  //   <Gif
  //     src={path.join(__dirname, 'public', 'boot.gif')}
  //     height={height}
  //     width={Math.round(height * 960 / 445)} // keep aspect ratio of the source (960×445)
  //     loop={false}
  //     playing={!booted}
  //   />
  //   </Box>
  // );

  // Wide Touch Bars (no physical Esc key) report a wider panel — show a fixed
  // Esc at the far left and inset the layer area by its width. Only in 'all'
  // mode; 'fn' mode renders Esc inside the Fn-key layer instead.
  const showEsc = width >= ESC_KEY.minWidth && ESC_KEY.onLayers === 'all';

  return (
    <SafeArea width={width} height={height}>
      {(w, h) => {
        const layerW = showEsc ? w - ESC_KEY.width - ESC_KEY.gap : w;
        const layerHost = (
          <LayerHost
            keyboard={keyboard}
            fnLayer="fnkeys"
            fnMode={FN_LAYER.mode}
            fnLongMs={FN_LAYER.longMs}
            home="splitted"
            toggles={[{ key: DOCK.shortcut.key, layer: 'dock', longMs: DOCK.shortcut.longMs }]}
            layers={[
              { name: 'splitted',          component: SplittedLayer,          leaving: { outAnim: 'slide-down'  }, entering: { inAnim: 'slide-up'  } },
              { name: 'dock',              component: DockLayer,               leaving: { outAnim: 'slide-down' }, entering: { inAnim: 'slide-up'   } },
            { name: 'media',             component: MediaScreen,             leaving: { outAnim: 'slide-right' }, entering: { inAnim: 'slide-left'   } },
            { name: 'audio-slider',      component: AudioSliderLayer,        leaving: { outAnim: 'slide-down'  }, entering: { inAnim: 'slide-up'     } },
            { name: 'brightness-slider', component: BrightnessSliderLayer,   leaving: { outAnim: 'slide-down'  }, entering: { inAnim: 'slide-up'     } },
            { name: 'fnkeys',            component: FnKeys,                  leaving: { outAnim: 'fade', duration: 0 }, entering: { inAnim: 'fade', duration: 0 } },
            { name: 'systembar',         component: SystemBar,               leaving: { outAnim: 'slide-down'  }, entering: { inAnim: 'slide-up'     } },
          ]}
            width={layerW}
            height={h}
          />
        );

        if (!showEsc) return layerHost;

        return (
          <Box style={{ width: w, height: h, alignItems: 'stretch', gap: ESC_KEY.gap }}>
            <EscKey width={ESC_KEY.width} height={h} />
            {layerHost}
          </Box>
        );
      }}
    </SafeArea>
  );
}
