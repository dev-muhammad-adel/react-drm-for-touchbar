import React from 'react';
import { KeyboardReader } from 'react-drm';
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
import { useBootSequence } from './hooks/useBootSequence';
const keyboard = new KeyboardReader(); // auto-detects kbd device via /proc/bus/input/devices

export function App({ width, height }: { width: number; height: number }) {
  const { booted, opacity } = useBootSequence();

  // if (!booted) return <BootScreen width={width} height={height} opacity={opacity} />;

  return (
    <SafeArea width={width} height={height}>
      {(w, h) => (
        <LayerHost
          keyboard={keyboard}
          fnLayer="fnkeys"
          layers={[
            { name: 'splitted',          component: SplittedLayer,          leaving: { outAnim: 'slide-right' }, entering: { inAnim: 'slide-right'  } },
            { name: 'media',             component: MediaScreen,             leaving: { outAnim: 'slide-left'  }, entering: { inAnim: 'slide-left'   } },
            { name: 'audio-slider',      component: AudioSliderLayer,        leaving: { outAnim: 'slide-up'    }, entering: { inAnim: 'slide-down'   } },
            { name: 'brightness-slider', component: BrightnessSliderLayer,   leaving: { outAnim: 'slide-up'    }, entering: { inAnim: 'slide-down'   } },
            { name: 'fnkeys',            component: FnKeys,                  leaving: { outAnim: 'fade', duration: 0 }, entering: { inAnim: 'fade', duration: 0 } },
            { name: 'services',          component: BackgroundServices,      leaving: { outAnim: 'slide-up'    }, entering: { inAnim: 'slide-up'     } },
            { name: 'systembar',         component: SystemBar,               leaving: { outAnim: 'slide-down'  }, entering: { inAnim: 'slide-down'   } },
          ]}
          width={w}
          height={h}
        />
      )}
    </SafeArea>
  );
}
