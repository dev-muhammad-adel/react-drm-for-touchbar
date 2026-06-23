  import React from 'react';
import { Box, Button, Text } from 'react-drm';
import {
  MdAdd, MdClose, MdChevronLeft, MdChevronRight,
} from 'react-icons/md';
import { useKonsole } from '../../hooks/useKonsole';

const GREEN  = '#22c55e';
const ORANGE = '#f97316';
const PURPLE = '#a78bfa';
const DIM    = '#64748b';

const CHIP_W   = 110;
const CHIP_GAP = 4;

export function KonsolePanel({ width, height }: { width: number; height: number }) {
  const {
    connected, tabCount, activeTabIdx, status, suggestions,
    newTab, closeTab, nextTab, prevTab, sendSuggestion,
  } = useKonsole();

  const ICON_SZ   =32;
  const DOT_SZ    = 8;
  const middleW   = Math.round(width * 0.65);

  function Btn({ onClick, children, accent }: { onClick: () => void; children: React.ReactNode; accent?: string }) {
    return (
      <Button
        color="#444444"
        activeColor={accent ?? GREEN}
        style={{ height, alignItems: 'center', justifyContent: 'center', borderRadius: 10, flex: 1 }}
        onClick={onClick}
      >
        {children}
      </Button>
    );
  }

  function Sep() {
    return <Box style={{ width: 1, height: height - 16, backgroundColor: '#1e293b', marginLeft: 2, marginRight: 2 }} />;
  }

  if (!connected) {
    return (
      <Box style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text color={DIM} fontSize={12} fontFamily="IosevkaTerm Nerd Font">
          Konsole not running
        </Text>
      </Box>
    );
  }

  const dotColor   = status.isRunning ? ORANGE : GREEN;
  const statusText = status.isRunning ? status.foregroundCmd : status.cwd;
  const CHIP_RENDER_W = CHIP_W * 3;
  const ICON_BOX_W   = 24;

  return (
    <Box style={{ flex: 1, flexDirection: 'row', gap: 4 }}>

      {/* ── Tab navigation ── */}
      <Btn onClick={prevTab}>
        <MdChevronLeft style={{ width: ICON_SZ, height: ICON_SZ }} fill={GREEN} stroke="none" />
      </Btn>
      <Box style={{ width: 40, alignItems: 'center', justifyContent: 'center' }}>
        <Text color="#fff" fontSize={11} fontFamily="IosevkaTerm Nerd Font">
          {tabCount > 0 ? `${activeTabIdx + 1}/${tabCount}` : '–'}
        </Text>
      </Box>
      <Btn onClick={nextTab}>
        <MdChevronRight style={{ width: ICON_SZ, height: ICON_SZ }} fill={GREEN} stroke="none" />
      </Btn>

      <Sep />

      {/* ── Middle: scroll box shows suggestions when typing, status otherwise ── */}
      {suggestions.length > 0 ? (
        <Box style={{ width: middleW, overflow: 'scroll', flexDirection: 'row'}}>
          <Box style={{ width: ICON_BOX_W, alignItems: 'center', justifyContent: 'center' }}>
            <Text color={PURPLE} fontSize={11} fontFamily="IosevkaTerm Nerd Font">❯</Text>
          </Box>
          {suggestions.map((s, i) => {
            const accent = s.execute ? PURPLE : GREEN;
            return (
              <Button
                key={i}
                color={s.execute ? '#1e1b2e' : '#122117'}
                activeColor={accent}
                style={{ width: CHIP_RENDER_W, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginRight: CHIP_GAP }}
                onClick={() => sendSuggestion(s)}
              >
                <Text color={accent} fontSize={10} fontFamily="IosevkaTerm Nerd Font">
                  {s.cmd.length > 20 ? s.cmd.slice(0, 20) + '…' : s.cmd}
                </Text>
              </Button>
            );
          })}
        </Box>
      ) : (
        <Box style={{ width: middleW, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 8 }}>
          <Box style={{ width: DOT_SZ, height: DOT_SZ, borderRadius: DOT_SZ / 2, backgroundColor: dotColor }} />
          <Text color={dotColor} fontSize={12} fontFamily="IosevkaTerm Nerd Font">
            {statusText || '…'}
          </Text>
        </Box>
      )}

      <Sep />

      <Btn onClick={newTab} accent={GREEN}>
        <MdAdd style={{ width: ICON_SZ, height: ICON_SZ }} fill="#4ade80" stroke="none" />
      </Btn>
      <Btn onClick={closeTab} accent="#f87171">
        <MdClose style={{ width: ICON_SZ, height: ICON_SZ }} fill="#f87171" stroke="none" />
      </Btn>

    </Box>
  );
}
