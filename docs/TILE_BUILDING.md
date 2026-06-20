# Building routing tiles

The WASM module is built with Valhalla's data tools disabled, so it cannot build tiles
itself — it only *consumes* them. Build tiles with the upstream Valhalla CLI. The
[`scripts/`](../scripts/README.md) reference does this via Docker so you need no local
Valhalla install.

## Flow

```
OSM extract (.osm.pbf)         ── from Geofabrik
        │  valhalla_build_config
        ▼
Valhalla config (.json)        ── driving-only (pedestrian/bike/elevation stripped)
        │  valhalla_build_tiles
        ▼
Tile graph (dir of .gph)       ── the routing graph
        │  tar (uncompressed)
        ▼
<id>_routing.tar               ── what the browser worker reads
```

## Steps

1. **OSM extract.** Download a region extract from
   [Geofabrik](https://download.geofabrik.de/) (`*.osm.pbf`). Start small (a single state
   or smaller) — planet-scale builds take hours and lots of disk.
2. **Config.** `valhalla_build_config` emits a default config; the reference script slims
   it to driving-only (`include_bicycle=false`, `include_pedestrian=false`, no elevation)
   to keep tiles small. This must stay consistent with the routing config the worker uses
   (also driving-focused; see `web/routingCore.ts`).
3. **Build.** `valhalla_build_tiles -c config.json region.osm.pbf` produces the tile graph
   (numbered `0/ 1/ 2/ …` directories of `.gph` files).
4. **Archive.** `tar` the **contents** of the tile directory (numbered dirs at the archive
   root) into `<id>_routing.tar`. Exclude macOS resource forks (`._*`). The worker reads
   this uncompressed tar and mounts each entry under `/valhalla_tiles/`.

All of the above is automated in `scripts/build_tiles.js`:

```bash
node scripts/build_tiles.js                       # example regions → ./scripts/build/
node scripts/build_tiles.js my-regions.json       # your own list
```

## Region ids

A region id is just a label. The worker requests regions by id and the `TileSourceFactory`
resolves each to bytes (the default expects `<id>_routing.tar`). rivers.run uses ISO-style
`US-CO`, `US-WY`, etc., but any naming works as long as build output, storage, and the
`regions` array in each `RoutingRequest` agree.

## Cross-region routes

To route across a boundary, request every region the path may traverse:
`regions: ['US-CO', 'US-WY']`. Each is mounted into the same `/valhalla_tiles/` tree before
routing. Tiles must exist for the whole corridor or routing fails near the gap.

## Compression

`build_tiles.js --gzip` also emits `<id>_routing.tar.gz` for cheaper transport. Serve it
with `Content-Encoding: gzip` so the browser decompresses on download and you store the
plain `.tar`. (rivers.run additionally pre-compresses individual `.gph` tiles with a custom
`VZIP` container; that optimization is rivers.run-specific and not included here.)
