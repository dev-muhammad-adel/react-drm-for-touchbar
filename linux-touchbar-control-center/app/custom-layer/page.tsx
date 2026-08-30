import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, Button, snapToGrid, SAFE_INSET_X, SAFE_INSET_Y } from 'react-drm';
import type { CustomWidget } from 'react-drm';
import { CUSTOM_WIDGET_LABELS, CUSTOM_WIDGET_WIDTHS, CUSTOM_WIDGET_MIN_WIDTH, CUSTOM_WIDGET_MAX_WIDTH } from 'react-drm';
import { MdCheck, MdDelete } from 'react-icons/md';
import { FaTrash } from 'react-icons/fa';
import { BackButton } from '@/components/BackButton';
import type { LayerConfig } from '@/lib/routes/loadRoutes';
import { getCustomLayerStore } from '@/lib/customLayer';
import type { CustomLayerState } from '@/lib/customLayer';
import { Clock } from '@/widgets/Clock';
import { CapsLock } from '@/widgets/CapsLock';
import { ActiveWindowTitle } from '@/widgets/ActiveWindowTitle';
import { Clipboard } from '@/widgets/Clipboard';
import { DiRackspace } from 'react-icons/di';
import { RiDragMove2Fill, RiDragMove2Line, RiDragMoveFill } from "react-icons/ri";

export const layerConfig: LayerConfig = {
  leaving:  { outAnim: 'slide-down' },
  entering: { inAnim:  'slide-up' },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

// How far past the bar's right edge a widget has to be dragged, horizontally,
// before release removes it instead of snapping back — a deliberate
// swipe-off-the-edge rather than the vertical "swipe up" gesture normally
// used for this, which would fight the horizontal-only drag axis on a bar
// this short. Only the right edge does this (matches the trash hint pinned
// there) — the left edge stays a hard clamp. Also doubles as the max the
// widget is allowed to visually overshoot the edge by, so the drag itself is
// the removal's only feedback.
const EDGE_REMOVE_THRESHOLD = 40;

/**
 * One placed widget. Doubles as the on-device drag surface once editing:
 * a long-press (Button's built-in onLongPress) enters edit mode and picks
 * the widget up in the same continuous touch; once editing is already true
 * (from any source — an in-progress config-gui drag counts too, via the
 * `editing` flag derived in CustomLayerPage), touching a widget drags it
 * immediately. Release commits the new position straight to the store,
 * which persists it — no separate on-device Save step.
 */
function DraggableWidget({ widget, editing, barWidth, barHeight, leftInset, onEnterEdit, onCommit, onRemove, onResize }: {
  widget: CustomWidget;
  editing: boolean;
  barWidth: number;
  barHeight: number;
  leftInset: number;
  onEnterEdit: () => void;
  onCommit: (id: string, x: number, y: number) => void;
  onRemove: (id: string) => void;
  onResize: (id: string, width: number) => void;
}) {
  // Widgets fill the bar's full height and drag horizontally only (see
  // onTouchMove) — a single row, so there's no y to track beyond the fixed
  // 0 every widget renders at.
  const [liveX, setLiveX] = useState<number | null>(null);
  const [pastEdge, setPastEdge] = useState(false);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const grabRef = useRef({ dx: 0 });
  const draggingRef = useRef(false);
  const pastEdgeRef = useRef(false);
  const resizingRef = useRef(false);
  const resizeGrabRef = useRef(0);

  const x = liveX ?? widget.x;
  const dragging = liveX !== null;
  const renderWidth = liveWidth ?? widget.width;

  return (
    <Button
      x={x + leftInset} y={0} width={renderWidth} height={barHeight}
      color={pastEdge ? '#ef444455' : editing ? '#3b4354' : '#00000000'}
      activeColor="#57606f"
      borderColor={pastEdge ? '#ef4444' : editing ? '#575757' : '#00000000'}
      borderWidth={editing ? 1.5 : 1}
      opacity={dragging ? (pastEdge ? 0.4 : 0.6) : 1}
      style={{ alignItems: 'center', justifyContent: 'center'  , borderRadius:8}}
      longPressDelay={500}
      onLongPress={() => {
        draggingRef.current = true;
        if (!editing) onEnterEdit();
      }}
      onTouchStart={(tx) => {
        grabRef.current = { dx: tx - x - leftInset };
        draggingRef.current = editing;
        if (editing) setLiveX(x);
      }}
      onTouchMove={(tx) => {
        if (!draggingRef.current) return;
        const raw = snapToGrid(tx - grabRef.current.dx - leftInset);
        const maxX = barWidth - widget.width;
        const overshoot = Math.max(raw - maxX, 0);
        const past = overshoot >= EDGE_REMOVE_THRESHOLD;
        pastEdgeRef.current = past;
        setPastEdge(past);
        setLiveX(clamp(raw, leftInset, maxX + EDGE_REMOVE_THRESHOLD));
      }}
      onTouchEnd={() => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        const shouldRemove = pastEdgeRef.current;
        pastEdgeRef.current = false;
        setPastEdge(false);
        setLiveX(current => {
          if (current !== null) {
            if (shouldRemove) onRemove(widget.id);
            else onCommit(widget.id, clamp(current, leftInset, barWidth - widget.width), 0);
          }
          return null;
        });
      }}
      onTouchCancel={() => {
        draggingRef.current = false;
        pastEdgeRef.current = false;
        setPastEdge(false);
        setLiveX(null);
      }}
    >
      {widget.type === 'clock' ? <Clock />
        : widget.type === 'capslock' ? <CapsLock />
        : widget.type === 'activewindow' ? <ActiveWindowTitle />
        : widget.type === 'clipboard' ? <Clipboard />
        : widget.type === 'separator' ? (
            // Hairline divider spanning the bar's inner height.
            <Box style={{ width: 2, height: barHeight - 12, borderRadius: 1,
                          backgroundColor: '#6b7280' }} />)
        : <Text style={{ color: '#e5e7eb', fontSize: 14 }}>{CUSTOM_WIDGET_LABELS[widget.type]}</Text>}
      {editing && (
        // A drag handle, not a tap target — grabbing it grows/shrinks the
        // widget from its right edge without moving it. Registers as a
        // nested touch region (see TouchRegistry.touchStart: the innermost
        // bounds match wins), so a touch starting here never also reaches
        // the outer Button's own reposition/remove handling below.
        <Box style={{ position: 'absolute', right: 0, top: 0 }}>
          <Button
            width={14} height={barHeight}
            color="#57606f66" activeColor="#57606f"
            style={{ alignItems: 'center', justifyContent: 'center' }}
            onTouchStart={(tx) => {
              resizingRef.current = true;
              resizeGrabRef.current = tx;
              setLiveWidth(renderWidth);
            }}
            onTouchMove={(tx) => {
              if (!resizingRef.current) return;
              setLiveWidth(clamp(
                snapToGrid(widget.width + (tx - resizeGrabRef.current)),
                CUSTOM_WIDGET_MIN_WIDTH, CUSTOM_WIDGET_MAX_WIDTH,
              ));
            }}
            onTouchEnd={() => {
              if (!resizingRef.current) return;
              resizingRef.current = false;
              setLiveWidth(current => {
                if (current !== null) onResize(widget.id, current);
                return null;
              });
            }}
            onTouchCancel={() => { resizingRef.current = false; setLiveWidth(null); }}
          >
            <Text style={{ color: '#cbd5e1', fontSize: 12 }}>⋮</Text>
          </Button>
        </Box>
      )}
    </Button>
  );
}

/**
 * Prototype "Custom Layer" screen. Renders the store's committed pending
 * widgets, a live drag ghost while config-gui is dragging one in, and
 * supports repositioning/removing existing widgets directly on-device
 * (long-press to enter edit mode). Purely additive: never touches
 * config.ts / config.blueprint.ts, and the store is this screen's only
 * dependency beyond existing react-drm primitives.
 */
export default function CustomLayerPage({ width, height }: { width: number; height: number }) {
  const [state, setState] = useState<CustomLayerState>(() => getCustomLayerStore().getState());
  const [editingLocally, setEditingLocally] = useState(false);

  useEffect(() => getCustomLayerStore().subscribe(setState), []);

  // dirty ("there's something unsaved") is deliberately not part of this —
  // it can stay true long after any actual editing activity has stopped
  // (e.g. a config-gui drag committed but not yet Saved), which made the
  // whole screen look permanently stuck in edit mode. Edit-mode styling
  // should only reflect an interaction happening right now.
  const editing = editingLocally || state.ghost !== null;

  return (
    <Box style={{ width, height }}>
      <Box style={{
        backgroundColor:"red"
      }}>

      <BackButton animation="slide-down" />
      </Box>
      <Box style={{ position: 'absolute' , borderRadius:10, zIndex:-2, left: 0, top: 0, backgroundColor: editing ? '#ffffff22' : 'transparent', width: width, height: height  }}/>
 { editing && (state.widgets.length > 0 || state.ghost !== null) && <Box style={{ position: 'absolute' , zIndex:-1, left:( width/2) - 16, top: (height/2) - 16, width: 32, height: 32}}>
      <RiDragMove2Line style={{ width: 32, height: 32 }} fill="#575757" stroke="none" />
      </Box>
}
      {state.widgets.map(w => (
        <DraggableWidget
          key={w.id}
          widget={w}
          editing={editing}
          barWidth={width}
          barHeight={height}
          leftInset={state.leftInset}
          onEnterEdit={() => setEditingLocally(true)}
          onCommit={(id, x, y) => getCustomLayerStore().moveExisting(id, x, y)}
          onRemove={id => getCustomLayerStore().removeAndPersist(id)}
          onResize={(id, w) => getCustomLayerStore().resizeExisting(id, w)}
        />
      ))}

      {state.ghost && (
        // Same palette as an editing DraggableWidget above — a widget being
        // dragged in from config-gui is in the same "being placed" state as
        // one already on the bar mid-edit, so it should read as the same
        // object rather than its own one-off blue.
        <Box
          x={state.ghost.x + state.leftInset} y={0}
          width={CUSTOM_WIDGET_WIDTHS[state.ghost.widgetType]} height={height}
          color="#3b4354" borderColor="#575757" borderWidth={1.5}
          style={{ alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}
        >
          <Text style={{ color: '#e5e7eb', fontSize: 14 }}>{CUSTOM_WIDGET_LABELS[state.ghost.widgetType]}</Text>
        </Box>
      )}

      {state.widgets.length === 0 && !state.ghost && (
        <Box style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#475569', fontSize: 14 }}>
            No custom widgets yet — drag one in from the Config GUI
          </Text>
        </Box>
      )}

      {editing && (
        // The one way to leave edit mode, period — a single fixed control
        // instead of a "✓" repeated on every widget. Pinned to a corner
        // rather than following a widget: it means the same thing and lives
        // in the same place no matter which widget you were just touching.
        <Box style={{ position: 'absolute', left: 0, top: 0 , width,height }}>
          <Button
            width={92} height={height}
            color="#373737" activeColor="#474747"
            borderColor="#474747" borderWidth={1}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}
            onClick={() => setEditingLocally(false)}
          >
            <MdCheck style={{ width: 16, height: 16 }} fill="#fff" stroke="none" />
            <Text style={{ color: '#fff', fontSize: 13 }}>Done</Text>
          </Button>
        </Box>
      )}

      {editing && (
        // Static hint, not a drop target of its own — DraggableWidget's
        // onTouchMove/onTouchEnd already remove a widget dragged past this
        // (right) edge of the bar; this just makes that otherwise invisible
        // gesture discoverable. Left edge is a hard clamp, no removal there.
        <Box style={{
          position: 'absolute', right: 0, top: 0,
          width: 44, height,
          alignItems: 'center', justifyContent: 'center',
          // backgroundColor: '#ef4444d9', borderColor: '#fecaca55', borderWidth: 1,
          borderRadius: 8,
        }}>
          <FaTrash style={{ width: 18, height: 18 }} fill="#ef4444d9" stroke="none" />
        </Box>
      )}

    </Box>
  );
}
