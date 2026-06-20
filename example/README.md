# Example: offline routing in the browser

A minimal page that routes between two points using `valhalla.wasm` and a routing-tile
tar held in OPFS. It bundles the **real** `web/` worker (no duplicated logic).

## Run it

```bash
# 1. Bundle the worker + copy the prebuilt artifacts here (needs Node/npx).
./build-example.sh

# 2. Build a small tile archive and drop it next to this page.
node ../scripts/build_tiles.js              # builds US-DC + US-DE (needs Docker)
cp ../scripts/build/US-DC_routing.tar .

# 3. Serve over http (OPFS + workers require a same-origin context — file:// won't work).
npx --yes serve .
```

Open the printed URL, then click **Route**. The page loads `US-DC_routing.tar` into OPFS
on first run, spawns the worker, and prints the route distance/time, maneuver count, and
shape size. The default coordinates are inside Washington, DC.

## How it maps to the docs

- Storing the tar in OPFS and the message protocol: [../docs/INTEGRATION.md](../docs/INTEGRATION.md)
- Why memory stays small (lazy tile mounting): [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
- Building the tar: [../docs/TILE_BUILDING.md](../docs/TILE_BUILDING.md)

Generated files (`valhalla.worker.bundle.js`, copied `valhalla.js`/`valhalla.wasm`, and
`*_routing.tar`) are gitignored.
