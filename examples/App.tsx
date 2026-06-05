import React from 'react';
import { execSync } from 'child_process';
import { Box, Text } from 'react-drm';
import { Clock } from './components/Clock';
import { NameAndDogChase } from './components/NameAndDogChase';

const osName = execSync('grep PRETTY_NAME /etc/os-release').toString().split('"')[1] ?? 'Linux';
const kernel  = execSync('uname -r').toString().trim();

export function App({ width, height }: { width: number; height: number }) {
  return (
    <Box x={0} y={0} width={width} height={height} color="#0d0d0d">

      <Box x={0} y={0} width={200} height={height} color="#1e1e2e">
        <Text x={14} y={12} color="white" fontSize={34} fontFamily="monospace">
          react-drm
        </Text>
      </Box>

      <Box x={200} y={10} width={2} height={40} color="#333355" />

      <Text x={214} y={8}  color="#94a3b8" fontSize={20}>{osName}</Text>
      <Text x={214} y={34} color="#475569" fontSize={16}>{kernel}</Text>

      <NameAndDogChase left={620} right={width - 230} top={8} bottom={52} />

      <Box x={width - 222} y={10} width={2} height={40} color="#333355" />

      <Clock x={width - 210} />

    </Box>
  );
}
