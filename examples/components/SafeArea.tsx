import React from 'react';
import { Box, SAFE_INSET } from 'react-drm';

interface SafeAreaProps {
  width: number;
  height: number;
  children: (width: number, height: number) => React.ReactNode;
}

export function SafeArea({ width, height, children }: SafeAreaProps) {
  const inset = SAFE_INSET;
  return (
    <Box style={{
      paddingTop:    inset,
      paddingLeft:   inset,
      paddingRight:  inset,
      paddingBottom: inset,
      // backgroundColor:"white",
      width, height,
    }}>
      {children(width - inset * 2, height - inset * 2)}
    </Box>
  );
}
