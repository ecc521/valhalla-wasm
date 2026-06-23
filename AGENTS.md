# AGENTS.md — valhalla-wasm

Valhalla — the open-source C++ routing engine — compiled to **WebAssembly** with offline
turn-by-turn navigation. A browser worker reads routing tiles lazily from a `.tar` archive,
letting Valhalla's LRU cache load only the tiles a route actually touches (~20–50 MB instead
of the full multi-hundred-MB graph).

Extracted from [rivers.run](https://github.com/ecc521/rivers.run) for offline navigation in
remote areas without cell service.

## Repository Layout

- **`valhalla.js` / `valhalla.wasm`** — prebuilt WASM module (committed). ~7.4 MB.
- **`src/valhalla_worker.cpp`** — Embind wrapper exposing Valhalla's `tyr::actor` to JS.
- **`web/`** — storage-agnostic browser routing worker + the `TileSource` seam.
  - `web/valhallaRouting.worker.ts` — example Worker integration; copy as a starting point.
  - `createRoutingEngine()` / `createOpfsTarTileSourceFactory()` — the main exports.
- **`Dockerfile`, `build.sh`, `compile_wasm.sh`** — build-from-source pipeline (Docker).
  Compiling Valhalla + its C++ deps (Protobuf, SQLite3, libcurl, zlib, Boost, …) takes ~1 hr.
- **`scripts/`** — tile-building pipeline (Docker). Converts OpenStreetMap extracts → routing tiles.
  Run `scripts/build_tiles.js` to generate demo tiles. See `scripts/README.md`.
- **`example/`** — runnable in-browser demo. `./build-example.sh` bundles the worker + copies artifacts.
- **`versions.lock`** — pinned upstream refs (Valhalla, vcpkg, emsdk). Override per build.
- **`docs/`** — ARCHITECTURE.md, INTEGRATION.md, TILE_BUILDING.md.

## Commands

```bash
# Run from the repo root
npm install                # install dependencies
./example/build-example.sh # bundle the worker (needs Node)
npm run build              # same as above (defined in package.json)
```

For a quick demo:

```bash
# From repo root:
cd example
./build-example.sh                         # bundles the worker
node ../scripts/build_tiles.js             # generates demo tiles (needs Docker)
cp ../scripts/build/US-DC_routing.tar .
npx --yes serve .                          # open the URL, click "Route"
```

## Build from Source

Compiling Valhalla to WASM is a Docker-based process (~1 hr, heavy):

```bash
./build.sh      # builds the Docker image, runs compile_wasm.sh, emits valhalla.js/.wasm
```

Override upstream refs in `versions.lock` per build, e.g.:
- `VALHALLA_REF=<tag> ./compile_wasm.sh`
- `docker build --build-arg EMSDK_VERSION=4.0.6 .`

See `docs/ARCHITECTURE.md` for what the pipeline does.

## Storage is Pluggable

The `TileSource` interface is the only storage dependency. The default reads
`<region>_routing.tar` from **OPFS** (Origin Private File System), but you can implement it
over the native filesystem (Capacitor/Electron), HTTP range requests, IndexedDB, or an
in-memory buffer. The download/CDN/manifest layer is intentionally **not** prescribed —
you own that part.

## Key Constraints

1. **Tile archives are `.tar` files,** not gzipped. WASM mounts them as lazily-read virtual
   filesystems. Keep this in mind when building or sourcing tiles.

2. **The WASM module loads synchronously.** In the worker, do:
   ```ts
   declare const ValhallaModule: (o?: any) => Promise<any>;
   const instance = await ValhallaModule({ locateFile: (p: string) => `/${p}` });
   ```
   The `locateFile` callback tells the module where to find `valhalla.wasm` on your server.

3. **No build artifacts in commits.** `valhalla.js` and `valhalla.wasm` are already built
   and committed, so you can use the repo without Docker. Only run `./build.sh` if you're
   updating upstream Valhalla or dependencies.
