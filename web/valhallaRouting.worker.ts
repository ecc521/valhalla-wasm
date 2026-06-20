// Default Web Worker entry: Valhalla-WASM routing over tiles stored in OPFS.
//
// This is a thin wiring layer. It:
//   1. loads the Emscripten module (valhalla.js, served at the site root),
//   2. uses the OPFS `<region>_routing.tar` tile source, and
//   3. speaks the RoutingRequest/RoutingResponse message protocol.
//
// To use a different storage backend, copy this file and swap `tileSourceFactory`
// for your own TileSourceFactory — nothing else needs to change.

/// <reference lib="webworker" />

import type { RoutingRequest } from './types';
import { createRoutingEngine } from './routingCore';
import { createOpfsTarTileSourceFactory } from './tileSource';

// Some Emscripten builds expect a `global` reference.
(self as any).global = self;

// Load the Emscripten loader (valhalla.js) and its companion valhalla.wasm. Both
// must be served from the site root for the default locateFile below to find them.
importScripts('/valhalla.js');
declare const ValhallaModule: (opts?: any) => Promise<any>;

const route = createRoutingEngine({
    initModule: () => ValhallaModule({
        locateFile: (path: string) => `/${path}`, // find valhalla.wasm at the root
        print: (text: string) => console.log(`[Valhalla WASM] ${text}`),
        printErr: (text: string) => console.warn(`[Valhalla WASM] ${text}`),
    }),
    tileSourceFactory: createOpfsTarTileSourceFactory('offline_maps'),
    onProgress: (message) => self.postMessage({ success: false, progress: message }),
});

self.onmessage = async (event: MessageEvent<RoutingRequest>) => {
    try {
        self.postMessage(await route(event.data));
    } catch (error: any) {
        self.postMessage({ success: false, error: error?.message || String(error) });
    }
};
