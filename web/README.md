# `web/` — browser routing worker

Storage-agnostic, in-browser routing on top of the prebuilt `valhalla.js` /
`valhalla.wasm`. Tiles are read lazily from a `.tar` archive, so a route uses
~20–50 MB of memory instead of pre-loading the whole graph. See
[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for how that works.

## Files

| File | Role |
| --- | --- |
| `types.ts` | Public types: `RoutingRequest` / `RoutingResponse`, and the `TileSource` / `TileSourceFactory` storage seam. |
| `routingCore.ts` | The engine. Knows nothing about storage — depends only on `TileSourceFactory` + an `initModule` callback. Mounts tiles as lazy virtual files, configures Valhalla, runs the route. |
| `tileSource.ts` | `parseTarIndex(...)` plus `createOpfsTarTileSourceFactory(...)`, the default OPFS implementation. |
| `valhallaRouting.worker.ts` | Default Web Worker entry wiring the module + OPFS tile source + message protocol. |

## Message protocol

Post a `RoutingRequest` to the worker; receive `RoutingResponse` messages. Progress
updates arrive as `{ success: false, progress }` before the final result.

```ts
worker.postMessage({ start: [lng, lat], end: [lng, lat], regions: ['US-CO'] });
worker.onmessage = (e) => {
  const r = e.data; // RoutingResponse
  if (r.progress) return; // intermediate update
  if (r.success) { /* r.geometry, r.instructions, r.summary */ }
  else { /* r.error */ }
};
```

## Bringing your own storage

The worker's only storage dependency is a `TileSourceFactory` — `(region) =>
Promise<TileSource | null>`. The default reads `offline_maps/<region>_routing.tar`
from OPFS. To use the native filesystem (Capacitor/Electron), HTTP range requests,
IndexedDB, or a bundled buffer, implement `TileSource` (a `read(buffer, at, length)`
returning bytes synchronously, plus a parsed `entries` index) and pass your factory
to `createRoutingEngine`. Reads must be synchronous — Emscripten's FS read op is.

See [../docs/INTEGRATION.md](../docs/INTEGRATION.md) for a full example.

> These files are provided as TypeScript sources — bundle them with your app
> (Vite, esbuild, etc.). They are extracted from rivers.run's production worker.
