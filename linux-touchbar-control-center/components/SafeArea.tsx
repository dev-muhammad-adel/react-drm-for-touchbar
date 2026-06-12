import React from 'react';
import { Box, SAFE_INSET_X, SAFE_INSET_Y } from 'react-drm';

interface SafeAreaProps {
  width: number;
  height: number;
  children: (width: number, height: number) => React.ReactNode;
}

export function SafeArea({ width, height, children }: SafeAreaProps) {
  return (
    <Box style={{
      paddingTop:    SAFE_INSET_Y,
      paddingBottom: SAFE_INSET_Y,
      paddingLeft:   SAFE_INSET_X,
      paddingRight:  SAFE_INSET_X,
      // backgroundColor:"white",
      width, height,
    }}>
      {children(width - SAFE_INSET_X * 2, height - SAFE_INSET_Y * 2)}
    </Box>
  );
}
