import React from 'react';
import {Box ,Text} from "react-drm"
export function App({ width, height, keyboard }: { width: number; height: number; keyboard: KeyboardReader }) {


  return (
<Box style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
  <Text>hello from new touchbar app</Text>
</Box>
  );
}
