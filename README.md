# Valhalla WebAssembly Engine

This repository builds the Valhalla routing engine into a WebAssembly (WASM) module using Emscripten.

It is completely isolated from the main `rivers.run` project because compiling a massive C++ library like Valhalla (with Protobuf, Zlib, SQLite3, Libcurl, and Boost dependencies) is a complex, long-running build process.

## Architecture

1. `Dockerfile` - An Emscripten build environment.
2. `build.sh` - Orchestrates the C++ cross-compilation pipeline.
3. `src/` - Contains the custom Embind Javascript bindings to expose the C++ routing API (`tyr::actor`) to the browser.
