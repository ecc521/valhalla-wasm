#!/bin/bash
# Bundle the real web/ worker (TypeScript) into a classic worker script for the
# demo, and copy the prebuilt WASM artifacts next to this page. Requires Node/npx.
set -e
cd "$(dirname "$0")"

echo "Bundling worker → valhalla.worker.bundle.js"
npx --yes esbuild ../web/valhallaRouting.worker.ts \
    --bundle --format=iife --platform=browser \
    --outfile=valhalla.worker.bundle.js

echo "Copying prebuilt artifacts"
cp ../valhalla.js ../valhalla.wasm .

cat <<'EOF'

Done. Now:
  1. Build a tile archive and copy it here, e.g.
       node ../scripts/build_tiles.js          # builds US-DC + US-DE into ../scripts/build/
       cp ../scripts/build/US-DC_routing.tar .
  2. Serve this directory over http (OPFS + workers need a same-origin context):
       npx --yes serve .
  3. Open the printed URL and click "Route".
EOF
