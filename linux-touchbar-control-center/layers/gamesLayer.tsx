import React from 'react';
import { Box, Button, Text } from 'react-drm';
import { MdSportsEsports, MdPiano, MdSportsTennis } from 'react-icons/md';
import { BackButton } from '../components/BackButton';
import { useLayers } from '.';

export function GamesLayer({ width, height }: { width: number; height: number }) {
  const { go } = useLayers();

  return (
    <Box style={{ flex: 1, gap: 6 }}>

      <BackButton to="splitted" animation="slide-right" />

      <Button
        color="#1a1a2e"
        activeColor="#16213e"
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10 }}
        onClick={() => go('dino', 'slide-left')}
      >
        <MdSportsEsports style={{ width: 28, height: 28 }} fill="#4ade80" stroke="none" />
        <Text color="#4ade80" fontSize={16} fontFamily="IosevkaTerm Nerd Font">DINO</Text>
      </Button>

      <Button
        color="#1a1a2e"
        activeColor="#16213e"
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10 }}
        onClick={() => go('piano', 'slide-left')}
      >
        <MdPiano style={{ width: 28, height: 28 }} fill="#a78bfa" stroke="none" />
        <Text color="#a78bfa" fontSize={16} fontFamily="IosevkaTerm Nerd Font">PIANO</Text>
      </Button>

      <Button
        color="#1a1a2e"
        activeColor="#16213e"
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10 }}
        onClick={() => go('pong', 'slide-left')}
      >
        <MdSportsTennis style={{ width: 28, height: 28 }} fill="#38bdf8" stroke="none" />
        <Text color="#38bdf8" fontSize={16} fontFamily="IosevkaTerm Nerd Font">PONG</Text>
      </Button>

    </Box>
  );
}
