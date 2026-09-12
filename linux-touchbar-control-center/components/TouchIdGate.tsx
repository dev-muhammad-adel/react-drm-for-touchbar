import React, { useEffect, useRef, useState } from 'react';
import { Box, easings, motion, MotionValues, Text, useSpringValue, addFluidObserver, removeFluidObserver } from 'react-drm';
import type { FluidEvent, MotionTransitionProp } from 'react-drm';
import { useTouchIdPrompt } from '@/lib/hooks/useTouchIdStatus';
import { FaArrowRightLong } from 'react-icons/fa6';
import { MdOutlineFingerprint } from 'react-icons/md';
import { SELECTED_THEME } from '@/lib/theme';

const ICON_SIZE = 30;
const FINGER_ICON_SIZE = 45;
const TOUCH_ID_WIDTH = 100;

const TRANSITION: MotionTransitionProp = { duration: 100, ease: easings.easeInOutQuad, repeatDelay: 10 };
const LOADING_TRANSITION: MotionTransitionProp = { duration: 500 };

const FAIL_UNLOCK_CUSTOMIZE_OF_FINGER: MotionValues = { left: [-5, 0, 5, 0, -5, 0, 5, 0, -5, 0], rotate: [-20, 0, 20, 0, 20, 0, 20, 0, 20, 0] };
const LOADING_UNLOCK_CUSTOMIZE_OF_FINGER: MotionValues = { opacity: [1, 0, 1, 0, 1, 0, 1] };
const SUCCESS_UNLOCK_CUSTOMIZE_OF_FINGER: MotionValues = { top: [-8, 1, 3, -3, -1, 2, -1, -1, 1, 0] };

type UnlockStatus = {
  isActive: boolean;
  status: 'fail' | 'success' | 'loading' | undefined;
  tries: number;
  message: undefined | string;
};

export interface TouchIdDeductInfo {
  /** true while the fingerprint block is active (deducting width). */
  active: boolean;
  /** Target width the block occupies when active (0 otherwise). */
  blockWidth: number;
  /** Live spring value of the deducted width, per frame while animating. */
  liveDeduct: number;
}

function CustomizeMap(status?: 'success' | 'fail' | 'loading' | undefined): { animation?: MotionValues; style: { color: string } } {
  if (status === 'success') return { animation: SUCCESS_UNLOCK_CUSTOMIZE_OF_FINGER, style: { color: SELECTED_THEME.success } };
  if (status === 'fail') return { animation: FAIL_UNLOCK_CUSTOMIZE_OF_FINGER, style: { color: SELECTED_THEME.error } };
  if (status === 'loading') return { animation: LOADING_UNLOCK_CUSTOMIZE_OF_FINGER, style: { color: SELECTED_THEME.primary } };
  return { style: { color: SELECTED_THEME.textPrimary } };
}

/**
 * The Touch ID unlock fingerprint block + stuck-prompt overlay. It does NOT
 * render the page slot — it reports the width it's deducting (and whether it's
 * active) through `onDeduct` so the layout can size its own children column
 * alongside it. Renders as a fragment so its children stay direct siblings of
 * the layout's children slot.
 */
export function TouchIdGate({ width, height, onDeduct }: {
  width: number;
  height: number;
  onDeduct?: (info: TouchIdDeductInfo) => void;
}) {
  const touchIdStatus = useTouchIdPrompt();
  const [unlockStatus, setUnlockStatus] = useState<UnlockStatus>({
    isActive: false,
    status: undefined,
    tries: 0,
    message: undefined,
  });
  const [hideMe, setHideMe] = useState(true);

  useEffect(() => {
    if (touchIdStatus === 'idle') {
      setUnlockStatus({
        ...unlockStatus,
        status: undefined,
        isActive: false,
      });
    } else {
      if (touchIdStatus === 'waiting') {
        setUnlockStatus({
          ...unlockStatus,
          isActive: true,
          status: undefined,
          message: unlockStatus.status === 'loading' ? 'Touch ID is stuck. Please try again.' : undefined,
        });
      }
      if (touchIdStatus === 'scanning') {
        setUnlockStatus({
          ...unlockStatus,
          status: 'loading',
          isActive: true,
        });
      }
      if (touchIdStatus === 'matched') {
        setUnlockStatus({
          ...unlockStatus,
          status: 'success',
          isActive: false,
        });
      }
      if (touchIdStatus === 'retry') {
        setUnlockStatus({
          ...unlockStatus,
          isActive: true,
          status: 'fail',
          tries: unlockStatus.tries + 1,
        });
      }
      if (touchIdStatus === 'failed') {
        setUnlockStatus({
          ...unlockStatus,
          status: 'fail',
          isActive: false,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touchIdStatus]);

  useEffect(() => {
    if (unlockStatus.isActive) {
      setHideMe(false);
    }
  }, [unlockStatus.isActive]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (unlockStatus.message && !unlockStatus.status) {
      timer = setTimeout(() => {
        setUnlockStatus({
          ...unlockStatus,
          status: undefined,
          message: undefined,
        });
      }, 6000);
    }
    return () => clearTimeout(timer);
  }, [unlockStatus.message]);

  // Live spring for the touch block's deducted width — bridges the per-frame
  // spring value up to onDeduct so the layout's children column can re-lay
  // out mid-animation, not just snap to the final value.
  const TOUCH_BLOCK_WIDTH = unlockStatus.isActive ? TOUCH_ID_WIDTH : 0;
  const deductSpring = useSpringValue(TOUCH_BLOCK_WIDTH, { delay: unlockStatus.isActive ? 0 : 1000, config: { duration: 400, easing: easings.easeInBack } });
  const [liveDeduct, setLiveDeduct] = useState(TOUCH_BLOCK_WIDTH);
  useEffect(() => {
    deductSpring.start(TOUCH_BLOCK_WIDTH, { delay: unlockStatus.isActive ? 0 : 1000 });
  }, [TOUCH_BLOCK_WIDTH, deductSpring]);
  useEffect(() => {
    const obs: { eventObserved(e: FluidEvent<number>): void } = {
      eventObserved(e) {
        if ('value' in e) setLiveDeduct((e as { value: number }).value);
      },
    };
    addFluidObserver(deductSpring, obs);
    return () => removeFluidObserver(deductSpring, obs);
  }, [deductSpring]);
  // Only touch the parent when something actually changed, so the callback
  // fires on real transitions/frames, not on every parent render.
  const prev = useRef<TouchIdDeductInfo>({ active: false, blockWidth: 0, liveDeduct: 0 });
  useEffect(() => {
    const info: TouchIdDeductInfo = { active: unlockStatus.isActive, blockWidth: TOUCH_BLOCK_WIDTH, liveDeduct };
    const p = prev.current;
    if (info.active !== p.active || info.blockWidth !== p.blockWidth || info.liveDeduct !== p.liveDeduct) {
      prev.current = info;
      onDeduct?.(info);
    }
  }, [unlockStatus.isActive, TOUCH_BLOCK_WIDTH, liveDeduct, onDeduct]);

  const touchBlock = !hideMe ? (
    <motion.Box
      initial={{ width: TOUCH_BLOCK_WIDTH }}
      animate={{ width: [TOUCH_BLOCK_WIDTH] }}
      onKeyframeComplete={() => {
        if (!unlockStatus.isActive) {
          setHideMe(true);
        }
      }}
      transition={{ duration: 800, ease: easings.easeOutCubic, delay: unlockStatus.isActive ? 0 : 1000 }}
      style={{
        alignSelf: 'flex-end',
        height, justifyContent: 'flex-end', overflow: 'hidden',
      }}
    >
      <Box style={{ gap: 2, paddingHorizontal: 5, alignItems: 'center', marginRight: 10 }}>
        <Box style={{ alignItems: 'center', paddingBottom: 2 }}>
          <motion.Box
            key={'' + unlockStatus.status + unlockStatus.tries}
            initial={{ rotate: 0, left: 0 }}
            animate={CustomizeMap(unlockStatus.status).animation}
            animateOnMount={true}
            transition={unlockStatus.status === 'loading' ? LOADING_TRANSITION : TRANSITION}
            style={{ position: 'relative', width: FINGER_ICON_SIZE, height: FINGER_ICON_SIZE }}
          >
            {<MdOutlineFingerprint style={{ width: FINGER_ICON_SIZE, height: FINGER_ICON_SIZE, opacity: 0.7 }} fill={CustomizeMap(unlockStatus.status).style.color} stroke="none" />}
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
  ) : null;

  const message = unlockStatus.message ? (
    <Box style={{ height, width, position: 'absolute', left: 0, display: 'flex', justifyContent: 'center', backgroundColor: '#000000dd', zIndex: 9999999999999, borderRadius: 10 }}>
      <Text>
        Touch ID is stuck. Please try again.
      </Text>
    </Box>
  ) : null;

  return (
    <>
      {message}
      {touchBlock}
    </>
  );
}