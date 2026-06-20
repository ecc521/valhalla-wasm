#!/bin/bash
set -e

echo "Starting Valhalla WASM Compilation Pipeline..."

# Pinned upstream references (see versions.lock). Override via environment, e.g.
#   VALHALLA_REF=<sha-or-tag> VCPKG_REF=<sha> ./compile_wasm.sh
VALHALLA_REF="${VALHALLA_REF:-f7764b337de93530374ac90978f638734139d93b}"
VCPKG_REF="${VCPKG_REF:-89dd0f4d241136b843fb55813b2f0fa6448c204d}"

# 1. Fetch Valhalla source at the pinned ref
if [ ! -d "valhalla" ]; then
    echo "Cloning Valhalla source at ${VALHALLA_REF}..."
    git clone https://github.com/valhalla/valhalla.git
    cd valhalla
    git checkout "${VALHALLA_REF}"
    git submodule update --init --recursive
    cd ..
else
    echo "Using existing Valhalla checkout (pinned ref: ${VALHALLA_REF})."
fi

# 2. Setup vcpkg at the pinned ref
if [ ! -f "vcpkg/vcpkg" ]; then
    echo "Setting up vcpkg at ${VCPKG_REF}..."
    if [ ! -d "vcpkg" ]; then
        git clone https://github.com/microsoft/vcpkg.git
        cd vcpkg
        git checkout "${VCPKG_REF}"
        cd ..
    fi
    ./vcpkg/bootstrap-vcpkg.sh -disableMetrics
fi

# 3. Disable Valhalla's manifest mode to avoid compiling hostile dependencies
if [ -f "valhalla/vcpkg.json" ]; then
    echo "Deleting Valhalla vcpkg.json to disable manifest mode..."
    rm valhalla/vcpkg.json
fi

# 4. Install WASM dependencies manually using classic vcpkg mode
echo "Installing C++ dependencies for WebAssembly (this will take a while)..."
export VCPKG_FORCE_SYSTEM_BINARIES=1
./vcpkg/vcpkg install \
    abseil \
    protobuf \
    sqlite3 \
    curl \
    zlib \
    lz4 \
    rapidjson \
    cxxopts \
    date \
    boost-algorithm \
    boost-foreach \
    boost-format \
    boost-geometry \
    boost-heap \
    boost-optional \
    boost-property-tree \
    boost-range \
    boost-tokenizer \
    --triplet wasm32-emscripten

# 5. Build Valhalla via emcmake
echo "Configuring Valhalla with emcmake..."
rm -rf valhalla/build
mkdir -p valhalla/build
cd valhalla/build

emcmake cmake .. -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_TOOLCHAIN_FILE=../../vcpkg/scripts/buildsystems/vcpkg.cmake \
    -DVCPKG_CHAINLOAD_TOOLCHAIN_FILE=$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake \
    -DVCPKG_TARGET_TRIPLET=wasm32-emscripten \
    -DENABLE_SERVICES=OFF \
    -DENABLE_TESTS=OFF \
    -DENABLE_TOOLS=OFF \
    -DENABLE_DATA_TOOLS=OFF \
    -DENABLE_PYTHON_BINDINGS=OFF \
    -DENABLE_NODE_BINDINGS=OFF \
    -DBUILD_SHARED_LIBS=OFF

echo "Compiling Valhalla..."
ninja
cd ../..

# 6. Link the WASM wrapper
echo "Linking Valhalla WASM wrapper..."
# Note: We link against abseil libraries manually as libvalhalla depends on them
ABSL_LIBS=$(ls vcpkg/installed/wasm32-emscripten/lib/libabsl_*.a | sed "s|vcpkg/installed/wasm32-emscripten/lib/lib||g" | sed "s|\.a||g" | sed "s|^|-l|g" | tr "\n" " ")

emcc -std=c++20 -O3 src/valhalla_worker.cpp \
    -o valhalla.js \
    --bind \
    -s MODULARIZE=1 \
    -s EXPORT_NAME=ValhallaModule \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s USE_PTHREADS=0 \
    -s DISABLE_EXCEPTION_CATCHING=0 \
    -s ERROR_ON_UNDEFINED_SYMBOLS=0 \
    -s FORCE_FILESYSTEM=1 \
    -s EXPORTED_RUNTIME_METHODS="['FS','NODEFS']" \
    -I valhalla \
    -I valhalla/build/src \
    -I vcpkg/installed/wasm32-emscripten/include \
    -I valhalla/third_party/date/include \
    -I valhalla/third_party/rapidjson/include \
    -I valhalla/third_party/cxxopts/include \
    -L valhalla/build/src \
    -lvalhalla \
    -L vcpkg/installed/wasm32-emscripten/lib \
    -lprotobuf-lite -lsqlite3 -lcurl -lz -llz4 $ABSL_LIBS \
    -lnodefs.js \
    --no-entry

echo "✅ Valhalla WASM Pipeline completed successfully!"
