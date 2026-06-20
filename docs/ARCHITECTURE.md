# Architecture

Two independent pieces: a **build pipeline** that compiles Valhalla to WebAssembly,
and a **browser routing layer** that runs that module against tiles read lazily from
local storage.

## 1. Compiling Valhalla to WASM

Valhalla is a large C++ project (Protobuf, SQLite3, libcurl, zlib, lz4, abseil, Boost).
The pipeline (`Dockerfile` + `build.sh` + `compile_wasm.sh`) does:

1. **Toolchain** — a Docker image with Emscripten (`emsdk`).
2. **Dependencies** — vcpkg in *classic* mode for the `wasm32-emscripten` triplet.
   Valhalla's own `vcpkg.json` is deleted first to disable *manifest* mode (its manifest
   pulls in host-oriented deps that don't cross-compile cleanly).
3. **Configure/build** — `emcmake cmake` with everything non-routing turned off
   (`ENABLE_SERVICES/TESTS/TOOLS/DATA_TOOLS/PYTHON_BINDINGS/NODE_BINDINGS=OFF`,
   static libs), then `ninja` builds `libvalhalla`.
4. **Link** — `emcc` links `src/valhalla_worker.cpp` (an Embind wrapper exposing
   `valhalla::tyr::actor_t`) against `libvalhalla` and the abseil archives, producing
   `valhalla.js` + `valhalla.wasm`. Notable flags: `MODULARIZE`, `ALLOW_MEMORY_GROWTH`,
   `FORCE_FILESYSTEM`, and NODEFS exports for filesystem access.

The Embind wrapper currently exposes `route()`; `locate`/`isochrone`/matrix are
straightforward to add (uncomment/extend in `valhalla_worker.cpp`).

Upstream refs are pinned in `versions.lock` for reproducibility.

## 2. Lazy tile mounting (the interesting part)

A planet (or even a US-state) Valhalla graph is far too large to load into WASM memory.
Instead of extracting the tile archive into the Emscripten filesystem, the worker mounts
each tile as a **virtual character device** patched to look like a regular file:

- `parseTarIndex()` reads only the tar **headers** to learn each tile's `{name, offset,
  size}` — it never reads tile bodies.
- Each tile is registered with `FS.mkdev` + a shared `read` stream op. The op pulls bytes
  from the `TileSource` at `tileOffset + position` **only when Valhalla actually reads that
  tile**.
- Valhalla's LRU tile cache (`use_lru_mem_cache: true`, `max_cache_size`) keeps recently
  used tiles in memory, so each needed tile is read from storage exactly once.

Net effect: a route touches only the handful of tiles along the path. Memory stays around
**~20–50 MB** instead of the full multi-hundred-MB graph, and there is no upfront
extraction cost.

```
RoutingRequest ──▶ mount regions (tar index → virtual devices)
                      │  (no tile bodies read yet)
                      ▼
                 new ValhallaRouter(config)
                      │
                      ▼
                 router.route(req) ──▶ reads tiles on demand ──▶ TileSource.read(offset)
                                                                   └▶ LRU cache (read once)
```

## 3. Storage is pluggable

`routingCore.ts` depends only on a `TileSourceFactory` — `(region) => Promise<TileSource
| null>` — where a `TileSource` exposes a parsed `entries` index and a synchronous
`read(buffer, at, length)`. The default (`tileSource.ts`) reads
`offline_maps/<region>_routing.tar` from **OPFS** via a `SyncAccessHandle`. Anything that
supports synchronous random reads works: native filesystem, an in-memory buffer, HTTP
range requests with a sync shim, etc. (Reads must be synchronous because Emscripten's FS
read op is.)

### Prior art: how rivers.run stores tiles

rivers.run (the origin of this code) uses a dual strategy depending on platform, kept
deliberately **out** of this release so adopters aren't forced into it:

- **Web/PWA:** OPFS (`getDirectoryHandle` + `createWritable`) — exactly the default here.
- **Native (iOS/Android via Capacitor):** the native filesystem
  (`@capacitor/filesystem`, `Directory.Data`).

In both cases archives are downloaded from a CDN and stored as `<region>_routing.tar`.
That download/manifest/CDN layer is app-specific and is not part of this package — only
the read-side `TileSource` contract is.
