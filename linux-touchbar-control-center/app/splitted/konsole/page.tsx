  import React from 'react';
import type { LayerConfig } from '@/lib/routes/loadRoutes';

export const layerConfig: LayerConfig = { animation: 'fade' };
import { Box, Button, Text } from 'react-drm';
import {
  MdAdd, MdClose, MdChevronLeft, MdChevronRight,
} from 'react-icons/md';
import { useKonsole } from '@/lib/hooks/useKonsole';
import { SELECTED_THEME } from '@/lib/theme';

const PRIMARY  = SELECTED_THEME.primary;
const ERROR = SELECTED_THEME.error;
const TEXT_PRIMARY = SELECTED_THEME.textPrimary;
const DIM    = SELECTED_THEME.textPrimary;

const CHIP_W   = 110;
const CHIP_GAP = 4;

export default function KonsolePanel({ width, height }: { width: number; height: number }) {
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
        color={SELECTED_THEME.surface}
        activeColor={SELECTED_THEME.surfaceVariant ?? PRIMARY}
        style={{ height, alignItems: 'center', justifyContent: 'center', borderRadius: 10, flex: 1  , borderColor:SELECTED_THEME.border , borderWidth:SELECTED_THEME.borderWidth}}
        onClick={onClick}
      >
        {children}
      </Button>
    );
  }

  function Sep() {
    return <Box style={{ width: 1, height: height - 16, backgroundColor: 
    SELECTED_THEME.border, marginLeft: 2, marginRight: 2 }} />;
  }

  if (!connected) {
    return (
      <Box style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text color={DIM} fontSize={12}>
          Konsole not running
        </Text>
      </Box>
    );
  }

  const dotColor   = status.isRunning ? ERROR : PRIMARY;
  const statusText = status.isRunning ? status.foregroundCmd : status.cwd;
  const CHIP_RENDER_W = CHIP_W * 3;
  const ICON_BOX_W   = 24;

  return (
    <Box style={{ flex: 1, flexDirection: 'row', gap: 4 }}>

      {/* ── Tab navigation ── */}
      <Btn onClick={prevTab}>
        <MdChevronLeft style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
      </Btn>
      <Box style={{ width: 40, alignItems: 'center', justifyContent: 'center' }}>
        <Text color={DIM} fontSize={11}>
          {tabCount > 0 ? `${activeTabIdx + 1}/${tabCount}` : '–'}
        </Text>
      </Box>
      <Btn onClick={nextTab}>
        <MdChevronRight style={{ width: ICON_SZ, height: ICON_SZ }} fill={DIM} stroke="none" />
      </Btn>

      <Sep />

      {/* ── Middle: scroll box shows suggestions when typing, status otherwise ── */}
      {suggestions.length > 0 ? (
        <Box style={{ width: middleW, overflow: 'scroll', flexDirection: 'row'}}>
          <Box style={{ width: ICON_BOX_W, alignItems: 'center', justifyContent: 'center' }}>
            <Text color={TEXT_PRIMARY} fontSize={11}>❯</Text>
          </Box>
          {suggestions.map((s, i) => {
            return (
              <Button
                key={i}
                color={s.execute ? SELECTED_THEME.surface : SELECTED_THEME.surfaceVariant}
                activeColor={SELECTED_THEME.surfaceVariant}
                style={{ width: CHIP_RENDER_W, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: CHIP_GAP , borderColor:SELECTED_THEME.border , borderWidth:SELECTED_THEME.borderWidth }}
                onClick={() => sendSuggestion(s)}
              >
                <Text color={SELECTED_THEME.textPrimary} fontSize={13}>
                  {s.cmd.length > 20 ? s.cmd.slice(0, 20) + '…' : s.cmd}
                </Text>
              </Button>
            );
          })}
        </Box>
      ) : (
        <Box style={{ width: middleW, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 8 }}>
          <Box style={{ width: DOT_SZ, height: DOT_SZ, borderRadius: DOT_SZ / 2, backgroundColor: dotColor }} />
          <Text color={dotColor} fontSize={12}>
            {statusText || '…'}
          </Text>
        </Box>
      )}

      <Sep />

      <Btn onClick={newTab} accent={PRIMARY}>
        <MdAdd style={{ width: ICON_SZ, height: ICON_SZ }} fill={SELECTED_THEME.success} stroke="none" />
      </Btn>
      <Btn onClick={closeTab} accent={SELECTED_THEME.error}>
        <MdClose style={{ width: ICON_SZ, height: ICON_SZ }} fill={SELECTED_THEME.error} stroke="none" />
      </Btn>

    </Box>
  );
}
