// Public API for the valhalla-wasm package.
//
// These are storage-agnostic building blocks. Wire them into a Web Worker in your
// app (see docs/INTEGRATION.md) — worker instantiation is bundler-specific, so the
// package ships the logic, not a ready-made worker. The prebuilt Emscripten module
// (valhalla.js / valhalla.wasm) is shipped alongside; copy it to your served root.

export type {
    RoutingRequest,
    RoutingResponse,
    RoutingInstruction,
    RoutingSummary,
    LineString,
    TarEntry,
    TileSource,
    TileSourceFactory,
} from './types.js';

export { parseTarIndex, createOpfsTarTileSourceFactory } from './tileSource.js';
export { createRoutingEngine } from './routingCore.js';
export type { RoutingEngineOptions } from './routingCore.js';
