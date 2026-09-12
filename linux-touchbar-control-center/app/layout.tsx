import React, { useEffect, useState } from 'react';
import { Box, Button, easings, motion, MotionValues, Text, useSpringValue, addFluidObserver, removeFluidObserver } from 'react-drm';
import type { FluidEvent } from 'react-drm';
import { ESC_KEY, DOCK, FN_LAYER, CUSTOM_LAYER, THEME } from '@/lib/utils/configLoader';
import { EscKey } from '@/components/EscKey';
import { SafeArea } from '@/components/SafeArea';
import { BootScreen } from '@/components/BootScreen';
import { useBootSequence } from '@/lib/hooks/useBootSequence';
import { usePomodoroEngine } from '@/lib/hooks/usePomodoro';
import { useLayerToggle } from '@/lib/hooks/useLayerToggle';
import type { LayoutChildren } from '@/lib/routes/loadRoutes';
import { useTouchIdPrompt } from '@/lib/hooks/useTouchIdStatus';
import { FaArrowRightLong } from 'react-icons/fa6';
import { MdOutlineFingerprint } from 'react-icons/md';
import { SELECTED_THEME } from '@/lib/theme';

// No layoutConfig/initial here anymore — app/page.tsx (this segment's own
// sibling page) is root's default automatically, see loadRoutes.ts.

// Overlays toggled by a global hardware shortcut, not by navigating there —
// listed once so each binding's home fallback (below) knows not to flip
// straight into the other one.
const OVERLAYS = ['dock', 'fnkeys', 'custom-layer'];
const ICON_SIZE = 30;

export default function RootLayout({ width, height, children }: {
  width:    number;
  height:   number;
  children: LayoutChildren;
  path:     string; // '' — unused here, root addresses its own siblings by bare name
}) {
  useLayerToggle(DOCK.shortcut.key, 'dock', {
    mode: DOCK.shortcut.mode, longMs: DOCK.shortcut.longMs, doubleMs: DOCK.shortcut.doubleMs,
    home: 'splitted', overlays: OVERLAYS,
  });
  useLayerToggle('fn', 'fnkeys', {
    mode: FN_LAYER.mode, longMs: FN_LAYER.longMs, doubleMs: FN_LAYER.doubleMs,
    home: 'splitted', overlays: OVERLAYS,
  });
  useLayerToggle(CUSTOM_LAYER.shortcut.key, 'custom-layer', {
    mode: CUSTOM_LAYER.shortcut.mode, longMs: CUSTOM_LAYER.shortcut.longMs, doubleMs: CUSTOM_LAYER.shortcut.doubleMs,
    home: 'splitted', overlays: OVERLAYS,
  });
  const touchIdStatus = useTouchIdPrompt()
  const [unlockStatus , setUnlockStatus] = useState<{
    isActive : boolean;
    status:'fail'|'success'|undefined;
    tries : number;
  }>({
    isActive:false,
    status:undefined,
    tries:0

  })
  const [hideMe, setHideMe] = useState(true)
  const TRANSITION ={ duration: 100, ease: easings.easeInOutQuad, repeatDelay: 10 }
 const FAIL_UNLOCK_CUSTOMIZE_OF_FINGER:MotionValues =  { left:[-5,0,5,0,-5,0,5,0,-5,0],rotate:[-20,0,20,0,20,0,20,0,20,0] }
 const SUCCESS_UNLOCK_CUSTOMIZE_OF_FINGER:MotionValues =  {  top: [-8, 1, 3, -3, -1, 2, -1, -1, 1, 0]}
 function CustomizeMap (status?:"success"|'fail'|undefined){
  if(status === "success") 
    return {animation:SUCCESS_UNLOCK_CUSTOMIZE_OF_FINGER ,  style :{color:SELECTED_THEME.success}}
  if(status==='fail'){

    return {animation : FAIL_UNLOCK_CUSTOMIZE_OF_FINGER , style :{color:SELECTED_THEME.error}}
  }

    return { style : {color:SELECTED_THEME.textPrimary}}
}
  const { booted, opacity } = useBootSequence();
  usePomodoroEngine();

useEffect(()=>{

  if(touchIdStatus==='waiting'){
    setUnlockStatus({
      ...unlockStatus,
      isActive:true
    })

  }
    if(touchIdStatus==="matched"){
    
       setUnlockStatus({
      ...unlockStatus,
      status:'success',
      isActive:false,

    })
  }
  if(touchIdStatus==="retry"){
       setUnlockStatus({
      ...unlockStatus,
      isActive:true,
      status:"fail",
      tries:unlockStatus.tries + 1

    })
    
  }
    if(touchIdStatus==="failed"){
       setUnlockStatus({
      ...unlockStatus,
      status:"fail",
      isActive:false,

    })
    
  }

},[touchIdStatus])
 
useEffect(()=>{

if(unlockStatus.isActive){
  setHideMe(false)
}
},[unlockStatus.isActive])

  // Live spring for the touch block's deducted width — bridges the per-frame
  // spring value into React state so children(layerW - <live>, h) can re-lay
  // out mid-animation, not just snap to the final value.
  const layerWidth = unlockStatus.isActive ? 90 : 0
  const deductSpring = useSpringValue(layerWidth, { delay: unlockStatus.isActive ? 0 : 1000, config: { duration: 400, easing: easings.easeInBack } });
  const [liveDeduct, setLiveDeduct] = useState(layerWidth);
  useEffect(() => {
    deductSpring.start(layerWidth, { delay:unlockStatus.isActive ? 0:1000 });
  }, [layerWidth, deductSpring]);
  useEffect(() => {
    const obs: { eventObserved(e: FluidEvent<number>): void } = {
      eventObserved(e) {
        if ('value' in e) setLiveDeduct((e as { value: number }).value);
      },
    };
    addFluidObserver(deductSpring, obs);
    return () => removeFluidObserver(deductSpring, obs);
  }, [deductSpring]);
  if (!booted) {
    return <BootScreen width={width} height={height} opacity={opacity} />;
  }

  // Wide Touch Bars (no physical Esc key) report a wider panel — show a fixed
  // Esc at the far left and inset the layer area by its width. Only in 'all'
  // mode; 'fn' mode renders Esc inside the Fn-key layer instead.
  const showEsc = width >= ESC_KEY.minWidth && ESC_KEY.onLayers === 'all';
  const TOUCH_BLOCK_WIDTH = unlockStatus.isActive  ? 90 : 0

  console.log({TOUCH_BLOCK_WIDTH})
  return (
    <SafeArea width={width} height={height} fontFamily={THEME.fontFamily}>
      {(w, h) => {
        const layerW = showEsc ? w - ESC_KEY.width - ESC_KEY.gap : w;
        const layerHost = (
           <motion.Box
            initial={{ width:  layerW - TOUCH_BLOCK_WIDTH }}
            animate={{ width:   layerW - TOUCH_BLOCK_WIDTH }}
            transition={{ duration: [400, 400], ease: easings.easeInBack , delay:unlockStatus.isActive ? 0:1000}}
            style={{  height: h, overflow: 'hidden' }}
          >
            {children( layerW - liveDeduct, h)}
          </motion.Box>
        
        );

        const touchBlock =!hideMe ? (
          <motion.Box
            initial={{ width: TOUCH_BLOCK_WIDTH}}
            animate={{ width: [TOUCH_BLOCK_WIDTH]  }}
            onKeyframeComplete={()=>{
              if(!unlockStatus.isActive){
                setHideMe(true)
              }
            }}
            onAnimationComplete={()=>{
              console.log('n mount')
              // if(unlockStatus.status){
                // console.log('hi')

                // setTouchBlockVisible(unlockStatus.isActive)
              // }
            }}
            transition={{ duration: 800, ease: easings.easeOutCubic,delay:unlockStatus.isActive ? 0:1000 }}
            style={{
              alignSelf:"flex-end",
               height: h, justifyContent: 'flex-end', overflow: 'hidden',
            }}
          >
            <Box style={{ gap: 2, paddingHorizontal: 5, alignItems: 'center' }}>
              <Box style={{ alignItems: 'center', paddingBottom: 2 }}>
                {/* <Text style={{ fontSize: 15, opacity: 0.7 }}>Touch </Text> */}
                <motion.Box
                  key={''+unlockStatus.status + unlockStatus.tries}
                  initial={{ rotate: 0, left: 0 }}
                  animate={CustomizeMap(unlockStatus.status).animation}
                  animateOnMount={true}
                  transition={TRANSITION}
                  style={{ position: 'relative', width: ICON_SIZE, height: ICON_SIZE }}
                >
                  <MdOutlineFingerprint style={{ width: ICON_SIZE, height: ICON_SIZE, opacity: 0.7 }} fill={CustomizeMap(unlockStatus.status).style.color} stroke="none" />
                </motion.Box>
                <Text style={{ fontSize: 15, opacity: 0.7 }}> </Text>
              </Box>
              <motion.Box
                style={{ position: 'relative', alignItems: 'center', justifyContent: 'center' }}
                animate={{ left: [0, 10, 0] }}
                transition={{ duration: 1000, ease: easings.easeInOutQuad, repeat: Infinity, repeatDelay: 0 }}
              >
                <FaArrowRightLong style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />
              </motion.Box>
            </Box>
          </motion.Box>
        ):null;

        if (!showEsc) {
          return (
            <Box style={{ width: w, height: h, alignItems: 'stretch' }}>
              {layerHost}
              {touchBlock}
              <Box  style={{position:"absolute" ,left:400,height,width:500 , gap:10}}>

                <Button
  
  onClick={()=>{
 setUnlockStatus({
      ...unlockStatus,
      status:"fail",
      tries:unlockStatus.tries+1,
      isActive:true,

    })
  }}>
    <Text>

fail
    </Text>
  </Button>
    <Button
  
  onClick={()=>{
     setUnlockStatus({
      ...unlockStatus,
      status:'success',
      isActive:false,

    })
    
  }}>
    <Text>

success 
    </Text>
  </Button> 
      <Button
  
  onClick={()=>{
     setUnlockStatus({
      ...unlockStatus,
      status:undefined,
      isActive:true,

    })
    
  }}>
    <Text>

active
    </Text>
  </Button> 
              </Box>
            </Box>
          );
        }

        return (
          <Box style={{ width: w, height: h, alignItems: 'stretch', gap: ESC_KEY.gap }}>
            <EscKey width={ESC_KEY.width} height={h} />
            {layerHost}
            {touchBlock}
          </Box>
        );
      }}
    </SafeArea>
  );
}
