import React from 'react';
import type { KeyboardReader } from 'react-drm';
import { LayerHost } from './layers';

import { SafeArea } from './components/SafeArea';
import { BootScreen } from './components/BootScreen';
import { SplittedLayer } from './layers/splittedLayer';
import { MediaScreen } from './layers/mediaScreen';
import { FnKeys } from './layers/fnKeys';
import { BackgroundServices } from './layers/backgroundServices';
import { SystemBar } from './layers/systemBar';
import { AudioSliderLayer } from './layers/audioSlider';
import { BrightnessSliderLayer } from './layers/brightnessSlider';
import { GamesLayer } from './layers/gamesLayer';
import { DinoLayer } from './layers/dino';
import { PianoLayer } from './layers/piano';
import { PongLayer } from './layers/pong';
import { useBootSequence } from './hooks/useBootSequence';

export function App({ width, height, keyboard }: { width: number; height: number; keyboard: KeyboardReader }) {
  const { booted, opacity } = useBootSequence();

  if (!booted) return <BootScreen width={width} height={height} opacity={opacity} />;

  return (
    <SafeArea width={width} height={height}>
      {(w, h) => (
        <LayerHost
          keyboard={keyboard}
          fnLayer="fnkeys"
          layers={[
            { name: 'splitted',          component: SplittedLayer,          leaving: { outAnim: 'slide-left'  }, entering: { inAnim: 'slide-right'  } },
            { name: 'media',             component: MediaScreen,             leaving: { outAnim: 'slide-right' }, entering: { inAnim: 'slide-left'   } },
            { name: 'audio-slider',      component: AudioSliderLayer,        leaving: { outAnim: 'slide-down'  }, entering: { inAnim: 'slide-up'     } },
            { name: 'brightness-slider', component: BrightnessSliderLayer,   leaving: { outAnim: 'slide-down'  }, entering: { inAnim: 'slide-up'     } },
            { name: 'fnkeys',            component: FnKeys,                  leaving: { outAnim: 'fade', duration: 0 }, entering: { inAnim: 'fade', duration: 0 } },
            { name: 'services',          component: BackgroundServices,      leaving: { outAnim: 'slide-down'  }, entering: { inAnim: 'slide-up'     } },
            { name: 'systembar',         component: SystemBar,               leaving: { outAnim: 'slide-down'  }, entering: { inAnim: 'slide-up'     } },
            { name: 'games',             component: GamesLayer,              leaving: { outAnim: 'slide-right' }, entering: { inAnim: 'slide-left'   } },
            { name: 'dino',              component: DinoLayer,               leaving: { outAnim: 'slide-right' }, entering: { inAnim: 'slide-left'   } },
            { name: 'piano',             component: PianoLayer,              leaving: { outAnim: 'slide-right' }, entering: { inAnim: 'slide-left'   } },
            { name: 'pong',              component: PongLayer,               leaving: { outAnim: 'slide-right' }, entering: { inAnim: 'slide-left'   } },
          ]}
          width={w}
          height={h}
        />
      )}
    </SafeArea>
  );
}
