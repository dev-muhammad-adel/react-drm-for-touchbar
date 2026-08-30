import net from 'node:net';
import fs from 'node:fs';
import {
  customLayerSocketPath, encodeMessage, createMessageReader, createLogger,
} from 'react-drm';
import type { CustomLayerClientMessage, CustomLayerServerMessage } from 'react-drm';
import { getCustomLayerStore } from './store';
import { go } from '@/lib/routes/router-registry';

const log = createLogger('custom-layer-bridge');

export interface CustomLayerBridgeHandle {
  stop(): void;
}

/**
 * Local Unix-socket server config-gui's main process connects to as a
 * client — the transport for the "virtual mouse" drag stream (config-gui
 * has no on-screen Touch Bar of its own; this is how a drag it starts
 * becomes a ghost widget moving on the real Touch Bar). Mirrors the shape of
 * src/dev/preview-server.ts's WS server, just over a Unix socket instead of
 * TCP since both ends are always on the same machine.
 */
export function startCustomLayerBridge(): CustomLayerBridgeHandle {
  const store = getCustomLayerStore();
  const socketPath = customLayerSocketPath();

  // A stale socket file from an unclean shutdown blocks a fresh listen.
  try { fs.unlinkSync(socketPath); } catch { /* didn't exist */ }

  const clients = new Set<net.Socket>();

  function stateMessage(): CustomLayerServerMessage {
    return { type: 'state', ...store.getState() };
  }

  function broadcastState(): void {
    const frame = encodeMessage(stateMessage());
    for (const client of clients) client.write(frame);
  }

  const unsubscribe = store.subscribe(broadcastState);

  const server = net.createServer(socket => {
    clients.add(socket);
    socket.write(encodeMessage(stateMessage()));

    const feed = createMessageReader<CustomLayerClientMessage>(message => {
      switch (message.type) {
        case 'requestState': socket.write(encodeMessage(stateMessage())); break;
        case 'dragStart':
          store.dragStart(message.widgetType);
          // The Touch Bar is the only visible surface for this drag —
          // config-gui has no on-screen preview of its own — so jump there
          // if some other screen currently happens to be showing.
          go('custom-layer');
          break;
        case 'dragMove':     store.dragMove(message.x, message.y); break;
        case 'dragEnd':      store.dragEnd(message.commit); break;
        case 'remove':       store.remove(message.id); break;
        case 'resize':       store.resize(message.id, message.width); break;
        case 'save':         store.save(); break;
        case 'reset':        store.reset(); break;
      }
    });

    socket.on('data', feed);
    socket.on('error', () => { /* client went away mid-write — non-fatal */ });
    socket.on('close', () => clients.delete(socket));
  });

  server.on('error', e => log.error('custom-layer bridge error:', e instanceof Error ? e.message : e));
  server.listen(socketPath, () => log.info(`custom-layer bridge listening at ${socketPath}`));

  return {
    stop() {
      unsubscribe();
      for (const client of clients) client.destroy();
      server.close();
      try { fs.unlinkSync(socketPath); } catch { /* already gone */ }
    },
  };
}
