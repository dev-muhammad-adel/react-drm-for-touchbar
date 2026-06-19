import React, { useMemo, useState } from 'react';
import { Box, Text, Button, SwipeZone } from 'react-drm';
import {
  MdSkipPrevious, MdPlayArrow, MdPause, MdSkipNext,
  MdChevronLeft, MdChevronRight,
} from 'react-icons/md';
import { useMediaPlayers } from '../../hooks/useMediaPlayers';
import { CgChevronDoubleDown } from 'react-icons/cg';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa6';

const ACCENT: Record<string, string> = {
  spotify: '#1db954',
  chrome:  '#4285f4',
};

const FONT = '';
export function MediaMprisList({ width, height }: { width: number; height: number }) {
  const { players } = useMediaPlayers();

  const [index, setIndex] = useState(0);
  const [dragX, setDragX] = useState(0);


  // const current = players[safeIndex];

const next = () => {
  if (index >= players.length - 1) return;
  setIndex(i => i + 1);
};

const prev = () => {
  if (index <= 0) return;
  setIndex(i => i - 1);
};
console.log(players[0]?.state.title)

  const iconSz = Math.round(height * 0.48);
const itemWidth = width - 12 * 2 - 6 * 2; // left/right padding + gap
  const trackWidth = useMemo(() => players.length * itemWidth, [players.length, itemWidth]);

  if (players.length === 0) {
    return (
      <Box style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 8 }}>
        <Text color="#94a3b8" fontSize={14} fontFamily={FONT}>
          No media players
        </Text>
      </Box>
    );
  }

  return (
    <Box style={{ flex: 1, flexDirection: 'row', alignItems: 'center',gap:6 }}>

      {/* left arrow */}
      <FaChevronLeft style={{ width: 12, height: 12 }} fill="#fff" />

      {/* VIEWPORT */}
      <Box
        style={{
          flex: 1,
          overflow: 'hidden',
          flexDirection: 'row',
        }}
      >

        <SwipeZone
          width={width}
          height={height}
          threshold={80}
          onScrollMove={(dx) => setDragX(dx)}
          onScrollEnd={() => setDragX(0)}
          onSwipeLeft={() => {
            setDragX(0);
            next();
          }}
          onSwipeRight={() => {
            setDragX(0);
            prev();
          }}
        >

          {/* TRACK */}
          <Box
            style={{
              flexDirection: 'row',
              width: trackWidth,
              marginLeft: -(index * itemWidth) + dragX,
            }}
          >

            {players.map((player, i) => {
              const color = ACCENT[player.name] ?? '#666';

              return (
                <Box
                  key={player.name + i}
                  style={{
                    width: itemWidth,
                    height,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingLeft: 8,
                    paddingRight: 8,
                    borderRadius: 8,
                    // backgroundColor: i === 0 ? 'red' : 'blue',
                  }}
                >

                  {/* prev */}
                  <Button
                    width={60}
                    height={height}
                    color="#3a3a3a" activeColor="#4f4b4f" style={{ alignItems: 'center', justifyContent: 'center', borderRadius: 6 }}
                    onClick={player.previous}
                  >
                    <MdSkipPrevious style={{ width: iconSz, height: iconSz }} />
                  </Button>

                  {/* play/pause */}
                  <Button
                    width={100}
                    height={height}
                    color={color}
                    onClick={player.playPause}
                    style={{ alignItems: 'center', justifyContent: 'center', borderRadius: 6 }}
                  >
                    {player.state.status === 'Playing'
                      ? <MdPause style={{ width: iconSz, height: iconSz }} />
                      : <MdPlayArrow style={{ width: iconSz, height: iconSz }} />
                    }
                  </Button>

                  {/* next */}
                  <Button
                    width={60}
                    height={height}
                    color="#3a3a3a" activeColor="#4f4b4f" style={{ alignItems: 'center', justifyContent: 'center', borderRadius: 6 }}
                    onClick={player.next}
                  >
                    <MdSkipNext style={{ width: iconSz, height: iconSz }} />
                  </Button>

                  {/* text */}
                  <Box style={{ flexDirection: 'column' }}>
                    <Text color="#fff" fontSize={15} fontFamily={FONT}>
                      {player.state.title || 'Unknown'}
                    </Text>

                    <Text color="#94a3b8" fontSize={12} fontFamily={FONT}>
                      {player.state.artist}
                    </Text>
                  </Box>

                </Box>
              );
            })}

          </Box>
        </SwipeZone>
      </Box>

      {/* right arrow */}
      <FaChevronRight style={{ width: 12, height: 12 }} fill="#fff" />

    </Box>
  );
}