import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import type { PreviewDisplay } from '../native/preview-display';
import type { RenderResult } from '../renderer/renderer';
import { createLogger } from '../logger';

const log = createLogger('preview-server');

// Wire protocol: every WS message is binary — a 16-byte header (width,
// height, stride, format as uint32 LE) followed by raw pixel bytes. Format 1
// = RGBA8888, already converted from Cairo's native byte order by
// PreviewDisplay/getFrameBuffer (see native/src/binding.cpp). Self-describing
// so the browser never has to guess dimensions or assume ARGB == RGBA.
const FORMAT_RGBA8888 = 1;
const HEADER_BYTES = 16;

// A frame is dropped for a client rather than queued once its socket buffer
// backs up past this — bounded memory over exact frame delivery.
const MAX_BUFFERED_BYTES = 1 << 20;

export interface PreviewServerOptions {
  port?: number;
  host?: string;
}

export interface PreviewServerHandle {
  url: string;
  stop(): void;
}

const PAGE_PATH = path.join(__dirname, 'preview-page.html');

/**
 * Serves the browser dev-preview page and streams PreviewDisplay's Cairo
 * framebuffer to it over WebSocket, forwarding the browser's simulated
 * touch input back into the same touchStart/Move/End API real Touch Bar
 * hardware drives (RenderResult from render()/renderHot()).
 */
export function startPreviewServer(
  display: PreviewDisplay,
  input: Pick<RenderResult, 'touchStart' | 'touchMove' | 'touchEnd'>,
  options: PreviewServerOptions = {},
): PreviewServerHandle {
  const port = options.port ?? (Number(process.env.REACT_DRM_PREVIEW_PORT) || 8787);
  const host = options.host ?? '127.0.0.1';

  const page = fs.readFileSync(PAGE_PATH);

  const httpServer = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  let lastFrame: Buffer | null = null;

  function frameMessage(rgba: Buffer, width: number, height: number): Buffer {
    const header = Buffer.alloc(HEADER_BYTES);
    header.writeUInt32LE(width, 0);
    header.writeUInt32LE(height, 4);
    header.writeUInt32LE(width * 4, 8); // PreviewDisplay buffers are always tightly packed
    header.writeUInt32LE(FORMAT_RGBA8888, 12);
    return Buffer.concat([header, rgba]);
  }

  // Fires once per completed native render — renderer.ts already rate-caps
  // and dedups blits upstream (RenderOptions.flushFps), so there's no need
  // for a second throttle here; this only guards against a slow WS client.
  display.onFrame = (rgba, width, height) => {
    const msg = frameMessage(rgba, width, height);
    lastFrame = msg;
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (client.bufferedAmount > MAX_BUFFERED_BYTES) continue;
      client.send(msg, { binary: true });
    }
  };

  wss.on('connection', (ws) => {
    if (lastFrame) ws.send(lastFrame, { binary: true });

    ws.on('message', (data) => {
      let msg: { type?: string; x?: number; y?: number };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (typeof msg.x !== 'number' || typeof msg.y !== 'number') return;
      const x = Math.max(0, Math.min(display.width - 1, Math.round(msg.x)));
      const y = Math.max(0, Math.min(display.height - 1, Math.round(msg.y)));
      switch (msg.type) {
        case 'touchstart': input.touchStart(x, y); break;
        case 'touchmove':  input.touchMove(x, y); break;
        case 'touchend':   input.touchEnd(x, y); break;
      }
    });
  });

  httpServer.listen(port, host, () => {
    log.info(`running at http://${host}:${port}`);
  });

  return {
    url: `http://${host}:${port}`,
    stop() {
      display.onFrame = undefined;
      for (const client of wss.clients) client.terminate();
      wss.close();
      httpServer.close();
    },
  };
}
