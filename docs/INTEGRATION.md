# Integration

How to route in the browser with the prebuilt module and the `web/` worker.

## 1. Serve the artifacts at the site root

The default worker loads `valhalla.js` and locates `valhalla.wasm` at the site root
(`/valhalla.js`, `/valhalla.wasm`). Copy both from this repo into your app's served root
(e.g. a Vite `public/` dir). To serve them elsewhere, change `importScripts(...)` and the
`locateFile` callback in `web/valhallaRouting.worker.ts`.

## 2. Get tiles into storage

The default worker reads `offline_maps/<region>_routing.tar` from OPFS. Build tiles with
[`scripts/build_tiles.js`](../scripts/README.md), then write each `.tar` into OPFS:

```ts
const root = await navigator.storage.getDirectory();
const dir = await root.getDirectoryHandle('offline_maps', { create: true });
const fh = await dir.getFileHandle('US-DC_routing.tar', { create: true });
const w = await fh.createWritable();
await w.write(await (await fetch('/tiles/US-DC_routing.tar')).arrayBuffer());
await w.close();
```

(If you fetch a `.tar.gz` served with `Content-Encoding: gzip`, the browser hands you the
decompressed bytes — store those.)

## 3. Spawn the worker and route

```ts
const worker = new Worker(new URL('./web/valhallaRouting.worker.ts', import.meta.url), { type: 'module' });

worker.onmessage = (e) => {
  const r = e.data; // RoutingResponse
  if (r.progress) { console.log(r.progress); return; }
  if (r.success) {
    console.log(r.summary);        // { distance (mi), time (s) }
    console.log(r.geometry);       // GeoJSON LineString, [lng, lat]
    console.log(r.instructions);   // [{ text, distance, time, type }]
  } else {
    console.error(r.error);
  }
};

worker.postMessage({
  start: [-77.036, 38.907],  // [lng, lat]
  end:   [-77.009, 38.890],
  regions: ['US-DC'],
});
```

A runnable version of this lives in [`../example/`](../example/).

## 4. Bring your own storage

Swap OPFS for any synchronous random-read source by implementing a `TileSourceFactory`.
Copy `web/valhallaRouting.worker.ts` and replace the factory:

```ts
import { createRoutingEngine } from './routingCore';
import { parseTarIndex } from './tileSource';
import type { TileSource } from './types';

// Example: tiles already fully in memory (e.g. bundled or fetched once).
function bufferTileSourceFactory(buffers: Record<string, Uint8Array>) {
  return async (region: string): Promise<TileSource | null> => {
    const buf = buffers[region];
    if (!buf) return null;
    const read = (into: Uint8Array, at: number, len: number) => {
      into.set(buf.subarray(at, at + len)); return Math.min(len, buf.length - at);
    };
    return { entries: parseTarIndex(read, buf.length), read };
  };
}

const route = createRoutingEngine({
  initModule: () => ValhallaModule({ locateFile: (p) => `/${p}` }),
  tileSourceFactory: bufferTileSourceFactory(myBuffers),
});
```

The `read` callback must be **synchronous** and return the number of bytes read.

## Notes

- `valhalla.js` / `valhalla.wasm` are large (~7.4 MB combined). Load the worker lazily.
- COOP/COEP headers are **not** required for the OPFS default (it does not use
  `SharedArrayBuffer`); the worker already handles the shared-buffer edge case if your
  environment enables it.
- The worker keeps the OPFS `SyncAccessHandle` open for on-demand reads; terminate the
  worker to release it.
