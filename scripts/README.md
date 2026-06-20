# `scripts/` — tile-building reference

The WASM module routes, but it needs **routing tiles**. The build pipeline turns off
Valhalla's data tools, so you build tiles separately with the upstream Valhalla CLI.
These scripts are a working reference for doing that with Docker (no local Valhalla
install needed). Full walkthrough: [../docs/TILE_BUILDING.md](../docs/TILE_BUILDING.md).

## Build tiles

```bash
# Build the example regions (DC + Delaware — small, quick) into ./build/
node build_tiles.js

# Or your own list, with options:
OUT_DIR=./out CONCURRENCY=4 node build_tiles.js my-regions.json
node build_tiles.js my-regions.json --gzip      # also produce .tar.gz for transport
```

Requires Docker. Each region yields an uncompressed `<id>_routing.tar` — the exact
format the worker reads. `regions.example.json` shows the input format:

```json
[{ "id": "US-DC", "geofabrik": "north-america/us/district-of-columbia-latest.osm.pbf" }]
```

## Tar layout the worker expects

The worker mounts every file in the archive under `/valhalla_tiles/`, preserving
paths. Archive the **contents** of the Valhalla tile directory at the archive root
(i.e. the numbered tile dirs `0/ 1/ 2/ …` sit at the top of the tar), which is what
`build_tiles.js` does. The worker reads the **uncompressed** `.tar`; if you transport
`.tar.gz`, make sure the client decompresses it before storing (see below).

## Serving / storing tiles (optional)

How tiles reach the device is entirely up to you. `upload_example.js` is a labeled
example for pushing archives to S3-compatible storage (AWS S3, Cloudflare R2, …) —
it has no hardcoded account or bucket. If you serve `.tar.gz` with
`Content-Encoding: gzip`, browsers decompress on download and you store the plain
`.tar`; otherwise serve/store uncompressed `.tar`.

> These scripts are deployment-flavored references, not a turnkey product. rivers.run
> uses a variant of them to publish ~50 US-state archives to Cloudflare R2.
