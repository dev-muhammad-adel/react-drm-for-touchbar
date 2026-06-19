import { useEffect, useState } from 'react';
import { readFile } from 'fs/promises';

// Resolve an MPRIS `mpris:artUrl` to a base64 `data:` URI so it can be embedded
// in inline SVG markup (librsvg decodes data URIs but won't fetch the network).
// Cached by URL — album art changes only on track change, so this runs rarely.

const cache = new Map<string, string>();

function mimeFromExt(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'png')  return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif')  return 'image/gif';
  return 'image/jpeg';
}

async function resolveArt(url: string): Promise<string> {
  const hit = cache.get(url);
  if (hit) return hit;

  let dataUri: string;
  if (url.startsWith('data:')) {
    dataUri = url;
  } else if (url.startsWith('file://') || url.startsWith('/')) {
    const path = url.startsWith('file://') ? decodeURIComponent(url.slice('file://'.length)) : url;
    const buf  = await readFile(path);
    dataUri = `data:${mimeFromExt(path)};base64,${buf.toString('base64')}`;
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`art fetch ${res.status}`);
    const mime = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    const buf  = Buffer.from(await res.arrayBuffer());
    dataUri = `data:${mime};base64,${buf.toString('base64')}`;
  }

  cache.set(url, dataUri);
  return dataUri;
}

/** Returns a `data:` URI for the given art URL, or null while loading / on failure. */
export function useAlbumArt(url: string | undefined): string | null {
  const [uri, setUri] = useState<string | null>(() => (url ? cache.get(url) ?? null : null));

  useEffect(() => {
    if (!url) { setUri(null); return; }
    const cached = cache.get(url);
    if (cached) { setUri(cached); return; }
    let alive = true;
    resolveArt(url)
      .then(u => { if (alive) setUri(u); })
      .catch(() => { if (alive) setUri(null); });
    return () => { alive = false; };
  }, [url]);

  return uri;
}
