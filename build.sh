#!/bin/bash
set -e

echo "🐳 Building Valhalla Emscripten Environment..."
docker build -t valhalla-wasm-builder .

echo "🚀 Running WASM Compilation..."
docker run --rm -v "$(pwd):/workspace" valhalla-wasm-builder bash -c "./compile_wasm.sh"

echo "✅ Build Complete!"
