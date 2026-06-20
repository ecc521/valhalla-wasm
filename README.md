# valhalla-wasm

[Valhalla](https://github.com/valhalla/valhalla) — the open-source C++ routing engine —
compiled to **WebAssembly**, with a browser worker that does fully **offline**
turn-by-turn routing by reading routing tiles lazily from local storage.

There is no official Valhalla WASM build. This repo provides one: the build pipeline, a
prebuilt module you can use immediately, and a small, storage-agnostic routing layer. It
was extracted from [rivers.run](https://rivers.run), which uses it for offline navigation
in remote areas with no cell service.

## What's the trick?

A Valhalla graph is far too big to load into WASM memory. Instead of extracting tiles, the
worker mounts each tile in a `.tar` archive as a **lazily-read virtual file** and lets
Valhalla's LRU cache pull only the tiles a route actually touches. A route uses **~20–50 MB**
instead of the full multi-hundred-MB graph. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start (use the prebuilt module)

The repo ships prebuilt `valhalla.js` + `valhalla.wasm` (~7.4 MB) — no build required.

```bash
cd example
./build-example.sh                      # bundle the worker + copy artifacts (needs Node)
node ../scripts/build_tiles.js          # build a small demo tile archive (needs Docker)
cp ../scripts/build/US-DC_routing.tar .
npx --yes serve .                       # open the URL, click "Route"
```

Then integrate it into your own app — copy `valhalla.js` + `valhalla.wasm` to your served
root and the `web/` worker into your bundle. Full guide: [docs/INTEGRATION.md](docs/INTEGRATION.md).

```ts
const worker = new Worker(new URL('./web/valhallaRouting.worker.ts', import.meta.url));
worker.onmessage = (e) => { /* RoutingResponse: geometry, instructions, summary */ };
worker.postMessage({ start: [-77.036, 38.907], end: [-77.009, 38.890], regions: ['US-DC'] });
```

## Layout

| Path | What |
| --- | --- |
| `valhalla.js`, `valhalla.wasm` | Prebuilt WASM module (committed). |
| `Dockerfile`, `build.sh`, `compile_wasm.sh` | The build-from-source pipeline. |
| `src/valhalla_worker.cpp` | Embind wrapper exposing Valhalla's `tyr::actor` to JS. |
| `web/` | Storage-agnostic browser routing worker + the `TileSource` seam. |
| `scripts/` | Reference pipeline to build routing tiles from OSM (Docker). |
| `example/` | Runnable in-browser demo. |
| `docs/` | Architecture, integration, and tile-building guides. |
| `versions.lock` | Pinned upstream refs (Valhalla, vcpkg, emsdk). |

## Build from source

Compiling Valhalla + its C++ dependencies (Protobuf, SQLite3, libcurl, zlib, Boost, …) to
WASM is a long (~1 hr), heavy process, so it runs in Docker:

```bash
./build.sh        # builds the Docker image, runs compile_wasm.sh, emits valhalla.js/.wasm
```

Upstream refs are pinned in `versions.lock`. Override per build, e.g.
`VALHALLA_REF=<tag> ./compile_wasm.sh` or
`docker build --build-arg EMSDK_VERSION=4.0.6 .`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for what the pipeline does.

## Build tiles

The module routes but needs tiles. [`scripts/`](scripts/README.md) builds them from OSM
extracts via Docker (no local Valhalla install). See [docs/TILE_BUILDING.md](docs/TILE_BUILDING.md).

## Storage is pluggable

The worker's only storage dependency is a `TileSource` — "give me bytes from a tile
archive." The default reads `<region>_routing.tar` from **OPFS**, but you can implement the
interface over the native filesystem (Capacitor/Electron), HTTP range requests, IndexedDB,
or an in-memory buffer. The download/CDN/manifest layer is intentionally **not** prescribed.

## License

MIT — see [LICENSE](LICENSE). Builds and redistributes upstream Valhalla (also MIT) and
other libraries; see [NOTICE](NOTICE) for attribution.
