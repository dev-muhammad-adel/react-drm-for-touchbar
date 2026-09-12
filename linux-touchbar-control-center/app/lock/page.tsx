




import React, { useEffect, useState } from 'react';
import path from 'path';
import { Box, Button, KEY, Svg, Text, motion, easings, MotionValues } from 'react-drm';
import {
  MdClose,
  MdBrightness4, MdBrightness7,
  MdMicOff,
  MdSearch,
  MdSkipPrevious, MdPlayArrow, MdSkipNext,
  MdVolumeOff, MdVolumeDown, MdVolumeUp,
  MdApps,
  MdPause,
  MdArrowRight,
  MdArrowForward,
  MdArrowBackIos,
  MdOutlineArrowForward,
  MdOutlineSubdirectoryArrowLeft,
  MdOutlineArrowOutward,
  MdFingerprint,
  MdOutlineFingerprint,
} from 'react-icons/md';
import { BackButton } from '@/components/BackButton';
import { keys } from '@/lib/services/keyInjector';
import { SELECTED_THEME } from '@/lib/theme';
import type { LayerConfig } from '@/lib/routes/loadRoutes';
import { HiArrowRight, HiMiniPlayPause } from 'react-icons/hi2';
import { HiArrowCircleDown } from 'react-icons/hi';
import { FaArrowRight, FaArrowRightLong, FaFingerprint } from 'react-icons/fa6';
import { IoIosArrowRoundForward } from 'react-icons/io';
import { BiFingerprint } from 'react-icons/bi';
import { useUnlockStatus } from '@/lib/hooks/useUnlockStatus';

export const layerConfig: LayerConfig = {
  leaving:  { outAnim: 'slide-right' },
  entering: { inAnim:  'slide-left' },
};

// app/media/page.tsx sits two levels under its own root in both trees
// (linux-touchbar-control-center/app/media in dev, dist/app/media once
// built, with assets/ copied alongside dist/ at build time) — same relative
// depth either way, so one formula covers both instead of a dev/built branch.
const KBD_ILLUM_DOWN_ICON = path.join(__dirname, '..', '..', 'assets', 'kbd_illum_down.svg');
const KBD_ILLUM_UP_ICON   = path.join(__dirname, '..', '..', 'assets', 'kbd_illum_up.svg');

// ── Actions ────────────────────────────────────────────────────────────────────

type Action =
  | 'BrightnessDown' | 'BrightnessUp'
  | 'IllumDown' | 'IllumUp'
  | 'Mute' | 'VolumeDown' | 'VolumeUp'
  | 'PreviousSong' | 'PlayPause' | 'NextSong'
  | 'Unknown';

function run(action: Action) {
  switch (action) {
    case 'BrightnessDown':   return keys.pressKey(KEY.BRIGHTNESSDOWN);
    case 'BrightnessUp':     return keys.pressKey(KEY.BRIGHTNESSUP);
    case 'IllumDown':        return keys.pressKey(KEY.KBDILLUMDOWN);
    case 'IllumUp':          return keys.pressKey(KEY.KBDILLUMUP);
    case 'VolumeDown':       return keys.pressKey(KEY.VOLUMEDOWN);
    case 'VolumeUp':         return keys.pressKey(KEY.VOLUMEUP);
    case 'NextSong':         return keys.pressKey(KEY.NEXTSONG);
    case 'PlayPause':         return keys.pressKey(KEY.PLAYPAUSE);
    case 'PreviousSong':         return keys.pressKey(KEY.PREVIOUSSONG);
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

const ICON_SIZE = 30;

function ToolBtn({ onClick, children }: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
    width={110}
      color={SELECTED_THEME.surface}
      activeColor={SELECTED_THEME.surfaceVariant}
      style={{  alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderColor: SELECTED_THEME.border, borderWidth: SELECTED_THEME.borderWidth }}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export default function LockScreen({ width, height }: { width: number; height: number }) {
  const unlockStatus = useUnlockStatus()
  const TRANSITION ={ duration: 100, ease: easings.easeInOutQuad, repeatDelay: 10 }
 const FAIL_UNLOCK_CUSTOMIZE_OF_FINGER:MotionValues =  { left:[-5,0,5,0,-5,0,5,0,-5,0],rotate:[-20,0,20,0,20,0,20,0,20,0] }
 const SUCCESS_UNLOCK_CUSTOMIZE_OF_FINGER:MotionValues =  {  top: [-8, 1, 3, -3, -1, 2, -1, -1, 1, 0]}
 function CustomizeMap (status?:"success"|"fail"|"loading"|undefined){
  if(status === "success") 
    return {animation:SUCCESS_UNLOCK_CUSTOMIZE_OF_FINGER ,  style :{color:SELECTED_THEME.success}}
  if(status === "fail"){

    return {animation : FAIL_UNLOCK_CUSTOMIZE_OF_FINGER , style :{color:SELECTED_THEME.error}}
  }
  if(status === "loading"){
    return {animation : { opacity:[1,0,1,0,1,0,1] } , style :{color:SELECTED_THEME.primary}}
  }

    return { style : {color:SELECTED_THEME.textPrimary}}
}
  const [hideMe, setHideMe] = useState(true);

   useEffect(() => {
     if (unlockStatus.isActive) {
       setHideMe(false);
     }
   }, [unlockStatus.isActive]);
  return (
    <Box style={{ flex: 1,gap: 10 }}>


<Box style={{flexGrow:1 , gap:24}}>

      <Box style={{gap:4 }} >

      <ToolBtn onClick={() => run('BrightnessDown')}>
        <MdBrightness4 style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />
      </ToolBtn>

      <ToolBtn onClick={() => run('BrightnessUp')}>
        <MdBrightness7 style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />
      </ToolBtn>
</Box>
  
    

      <Box style={{gap:4 }}   >

      <ToolBtn onClick={() => run('IllumDown')}>
        <Svg src={KBD_ILLUM_DOWN_ICON} width={ICON_SIZE} height={ICON_SIZE} />
      </ToolBtn>

      <ToolBtn onClick={() => run('IllumUp')}>
        <Svg src={KBD_ILLUM_UP_ICON} width={ICON_SIZE} height={ICON_SIZE} />
      </ToolBtn>
</Box>


      <Box style={{gap:4 }} >

      <ToolBtn onClick={() => run('Mute')}>
        <MdVolumeOff style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />
      </ToolBtn>

      <ToolBtn onClick={() => run('VolumeDown')}>
        <MdVolumeDown style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />
      </ToolBtn>

      <ToolBtn onClick={() => run('VolumeUp')}>
        <MdVolumeUp style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />
      </ToolBtn>
</Box>
      <Box style={{gap:4}} >



      <ToolBtn onClick={() => run('PlayPause')}>
        
        <HiMiniPlayPause style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />
      </ToolBtn>

</Box>
  {/* <ToolBtn

  onClick={()=>{
    const { tries } = unlockStatus;
    unlockStatus.setStatus({ isActive: true, status: 'fail', tries: tries + 1 });
  }}>
    <Text>

fail
    </Text>
  </ToolBtn>
    <ToolBtn

  onClick={()=>{
    unlockStatus.setStatus({ status: 'success', isActive: false });
  }}>
    <Text>

success
    </Text>
  </ToolBtn>
    <ToolBtn

  onClick={()=>{
    unlockStatus.setStatus({ status: 'loading', isActive: true });
  }}>
    <Text>

scan
    </Text>
  </ToolBtn>
    <ToolBtn

  onClick={()=>{
    unlockStatus.setStatus({ status: undefined, isActive: true });
  }}>
    <Text>

waiting
    </Text>
  </ToolBtn> */}
  
</Box>
{!hideMe&&<Box style={{flexGrow:1,justifyContent:"flex-end"}}>
  <Box style={{gap:8,paddingHorizontal:20 , alignItems:"center"}}>
<Box style={{alignItems:"center",paddingBottom:2}}>
  <Text style={{fontSize:15, opacity:0.7 }}>Touch </Text>
        <motion.Box
            key={'' + unlockStatus.status + unlockStatus.tries}
        initial={{rotate:0,left:0}}
         animate={CustomizeMap(unlockStatus.status).animation}
      onKeyframeComplete={(index) => {
        // console.log(index)
        if (!unlockStatus.isActive&& index===9) {
          setHideMe(true);
        }
      }}
         animateOnMount={true}
          transition={TRANSITION}
        style={{position:"relative",width: ICON_SIZE, height: ICON_SIZE}}>
            <MdOutlineFingerprint style={{ width: ICON_SIZE, height: ICON_SIZE , opacity:0.7}} fill={CustomizeMap(unlockStatus.status).style.color} stroke="none" />
          </motion.Box>


  <Text style={{fontSize:15, opacity:0.7}}> to unlock</Text>
</Box>
        <motion.Box
          style={{ position: 'relative', alignItems: 'center', justifyContent: 'center' }}
          animate={{ left: [0, 10, 0] }}
          transition={{ duration: 1000, ease: easings.easeInOutQuad, repeat: Infinity, repeatDelay: 0 }}
        >
          <FaArrowRightLong style={{ width: ICON_SIZE, height: ICON_SIZE }} fill={SELECTED_THEME.textPrimary} stroke="none" />
        </motion.Box>
  </Box>
</Box>
}

    </Box>
  );
}
