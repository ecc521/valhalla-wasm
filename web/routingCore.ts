// Storage-agnostic Valhalla-WASM routing engine.
//
// This module knows nothing about how tiles are stored or downloaded. It depends
// only on a TileSourceFactory (see types.ts) and an `initModule` callback that
// returns an initialized Emscripten module (exposing `.FS` and `.ValhallaRouter`).
// The default worker (valhallaRouting.worker.ts) wires these to OPFS + the
// prebuilt valhalla.js. Supply your own to route from native FS, HTTP, etc.

import type {
    RoutingRequest, RoutingResponse, RoutingInstruction, TileSource, TileSourceFactory, LineString,
} from './types.js';

let _nextDeviceMajor = 80;

function mkdirp(FS: any, dirPath: string) {
    const parts = dirPath.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
        current += '/' + part;
        try { FS.mkdir(current); } catch (_e) { /* already exists */ }
    }
}

/**
 * Mount every tile in a TileSource as a lazily-read virtual file in the WASM FS.
 *
 * Each tile is registered as a character device patched to look like a regular
 * file. When Valhalla reads a tile, the device's read op pulls the bytes from the
 * TileSource at the right offset. Combined with Valhalla's LRU tile cache
 * (use_lru_mem_cache=true), each tile is read from storage only once — so a route
 * uses ~20-50MB instead of pre-loading the whole (700MB+) graph.
 */
function mountTileSource(FS: any, source: TileSource): number {
    const major = _nextDeviceMajor++;
    let nextMinor = 0;

    const sharedOps = {
        open(stream: any) {
            stream.seekable = true;
            stream._tileOffset = stream.node._tileOffset;
            stream._tileSize = stream.node._tileSize;
        },
        read(stream: any, buffer: Uint8Array, offset: number, length: number, position: number) {
            const tileOffset = stream._tileOffset as number;
            const tileSize = stream._tileSize as number;

            const remaining = tileSize - position;
            if (remaining <= 0) return 0;
            const toRead = Math.min(length, remaining);

            // SyncAccessHandle.read (and friends) may not accept a SharedArrayBuffer view.
            let targetBuffer = buffer.subarray(offset, offset + toRead);
            const isShared = typeof SharedArrayBuffer !== 'undefined' &&
                buffer.buffer instanceof SharedArrayBuffer;
            if (isShared) targetBuffer = new Uint8Array(toRead);

            const bytesRead = source.read(targetBuffer, tileOffset + position, toRead);

            if (isShared && bytesRead > 0) buffer.set(targetBuffer.subarray(0, bytesRead), offset);
            return bytesRead;
        },
        write() { throw new Error('Valhalla routing tiles are read-only.'); },
        llseek(stream: any, offset: number, whence: number) {
            const tileSize = stream._tileSize as number;
            let position = offset;
            if (whence === 1) position += stream.position;
            else if (whence === 2) position = tileSize + offset;
            if (position < 0) throw new FS.ErrnoError(28);
            return position;
        },
    };

    function mountTile(filePath: string, dataOffset: number, dataSize: number) {
        const minor = nextMinor++;
        const dev = FS.makedev(major, minor);
        FS.registerDevice(dev, sharedOps);
        FS.mkdev(filePath, 0o644, dev);

        const node = FS.lookupPath(filePath).node;
        node.mode = 0o100644; // S_IFREG so stat() reports a regular file
        node.usedBytes = dataSize;
        node.size = dataSize;
        node._tileOffset = dataOffset;
        node._tileSize = dataSize;
    }

    let count = 0;
    for (const entry of source.entries) {
        const cleanName = entry.name.replace(/^\.\//, '');
        const filePath = `/valhalla_tiles/${cleanName}`;
        mkdirp(FS, filePath.substring(0, filePath.lastIndexOf('/')));
        mountTile(filePath, entry.offset, entry.size);
        count++;
    }
    return count;
}

function getValhallaConfig() {
    return {
        mjolnir: {
            tile_dir: '/valhalla_tiles',
            include_bicycle: true,
            include_driving: true,
            include_pedestrian: true,
            // Tile caching is critical: without it every tile is re-read + re-parsed
            // on each access. With it, each tile is read from storage exactly once.
            use_lru_mem_cache: true,
            lru_mem_cache_hard_control: false,
            max_cache_size: 209715200, // 200MB — only actively used tiles are cached
            hierarchy: true,
            logging: { color: true, type: 'std_out' },
        },
        loki: {
            actions: ['locate', 'route', 'sources_to_targets', 'optimized_route', 'isochrone', 'trace_route', 'trace_attributes', 'expansion', 'status'],
            logging: { color: true, type: 'std_out' },
            service_defaults: {
                heading_tolerance: 60, minimum_reachability: 10, node_snap_tolerance: 50,
                radius: 0, search_cutoff: 35000, street_side_max_distance: 1000, street_side_tolerance: 5,
                mvt_min_zoom_road_class: [6, 7, 8, 9, 10, 11, 12, 13],
                mvt_min_zoom_other: [6, 7, 8, 9, 10, 11, 12, 13],
                mvt_min_zoom_path: [6, 7, 8, 9, 10, 11, 12, 13],
                mvt_cache_min_zoom: 12, mvt_cache_max_zoom: 16, mvt_cache_size: 100,
            },
        },
        costing_options: {
            auto: { country_crossing_penalty: 0.0 },
            pedestrian: { walking_speed: 5.1, use_ferry: 0.5 },
        },
        thor: { source_to_target_algorithm: 'select_optimal', service: { proxy: 'ipc:///tmp/thor' } },
        odin: { logging: { color: true, type: 'std_out' }, service: { proxy: 'ipc:///tmp/odin' } },
        meili: {
            mode: 'auto', grid: { cache_size: 100240, size: 500 }, logging: { color: true, type: 'std_out' },
            default: {
                beta: 3, breakage_distance: 2000, geometry: false, gps_accuracy: 5.0,
                interpolation_distance: 10, max_route_distance_factor: 5, max_route_time_factor: 5,
                max_search_radius: 100, route: true, search_radius: 50, sigma_z: 4.07, turn_penalty_factor: 0,
            },
        },
        service_limits: {
            auto: { max_distance: 5000000.0, max_locations: 20, max_matrix_distance: 400000.0, max_matrix_location_pairs: 2500 },
            bicycle: { max_distance: 500000.0, max_locations: 50, max_matrix_distance: 200000.0, max_matrix_location_pairs: 2500 },
            pedestrian: { max_distance: 5000000.0, max_locations: 50, max_matrix_distance: 200000.0, max_matrix_location_pairs: 2500, max_transit_walking_distance: 10000, min_transit_walking_distance: 1 },
            truck: { max_distance: 5000000.0, max_locations: 20, max_matrix_distance: 400000.0, max_matrix_location_pairs: 2500 },
            isochrone: { max_contours: 4, max_distance: 25000.0, max_time_contour: 3600, max_distance_contour: 25000, max_locations: 1 },
            trace: { max_alternates: 3, max_alternates_shape: 100, max_distance: 200000.0, max_gps_accuracy: 100.0, max_search_radius: 100.0, max_shape: 16000 },
            skadi: { max_shape: 750000, min_resample: 10.0 },
            status: { allow_verbose: false },
            centroid: { max_distance: 200000.0, max_locations: 5 },
            max_alternates: 2, max_radius: 200, max_reachability: 50, max_exclude_locations: 50,
            max_exclude_polygons_length: 10000, max_timedep_distance: 500000,
            max_timedep_distance_matrix: 0, max_distance_disable_hierarchy_culling: 0,
        },
    };
}

/**
 * Decode a Google-encoded polyline. Valhalla uses 1e6 precision (6 decimals).
 */
function decodePolyline(encoded: string, precision = 1e6): [number, number][] {
    const coordinates: [number, number][] = [];
    let index = 0, lat = 0, lng = 0;
    while (index < encoded.length) {
        let shift = 0, result = 0, byte: number;
        do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
        lat += (result & 1) ? ~(result >> 1) : (result >> 1);
        shift = 0; result = 0;
        do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
        lng += (result & 1) ? ~(result >> 1) : (result >> 1);
        coordinates.push([lng / precision, lat / precision]); // GeoJSON is [lng, lat]
    }
    return coordinates;
}

function performRouting(valhallaRouter: any, start: number[], end: number[]): RoutingResponse {
    const routingRequest = {
        locations: [{ lon: start[0], lat: start[1] }, { lon: end[0], lat: end[1] }],
        costing: 'auto',
        units: 'miles',
    };

    const routeResult = valhallaRouter.route(JSON.stringify(routingRequest));
    const result = JSON.parse(routeResult);
    if (result.error) {
        let errorMsg = result.error;
        if (String(errorMsg).includes('No suitable edges') || result.error_code === 171) {
            errorMsg = 'Could not find a road near this location. Ensure tiles are mounted for all regions along the route.';
        }
        throw new Error(errorMsg);
    }

    const trip = result.trip;
    if (!trip || !trip.legs || trip.legs.length === 0) throw new Error('No route found.');

    const leg = trip.legs[0];
    const instructions: RoutingInstruction[] = leg.maneuvers.map((m: any) => ({
        text: m.instruction, distance: m.length, time: m.time, type: m.type ?? 0,
    }));

    let geometry: LineString | undefined;
    if (leg.shape) geometry = { type: 'LineString', coordinates: decodePolyline(leg.shape) };

    return {
        success: true,
        geometry,
        instructions,
        summary: { distance: trip.summary?.length ?? 0, time: trip.summary?.time ?? 0 },
    };
}

export interface RoutingEngineOptions {
    /** Resolve initialized Emscripten module (with `.FS` and `.ValhallaRouter`). */
    initModule: () => Promise<any>;
    /** Resolve a region id to tile bytes. */
    tileSourceFactory: TileSourceFactory;
    /** Optional progress callback (e.g. to postMessage progress to the main thread). */
    onProgress?: (message: string) => void;
}

/**
 * Create a reusable routing engine. The module and any mounted regions are cached
 * across calls; mounting a new region re-initializes the router.
 */
export function createRoutingEngine(opts: RoutingEngineOptions) {
    let wasmModule: any = null;
    let valhallaRouter: any = null;
    const mounted = new Set<string>();

    return async function route(request: RoutingRequest): Promise<RoutingResponse> {
        const { start, end, regions } = request;

        if (!wasmModule) {
            wasmModule = await opts.initModule();
            try { wasmModule.FS.mkdir('/valhalla_tiles'); } catch (_e) { /* ignore */ }
        }

        opts.onProgress?.('Loading map data…');
        let newlyMounted = false;
        for (const region of regions) {
            if (mounted.has(region)) continue;
            const source = await opts.tileSourceFactory(region);
            if (!source) continue;
            mountTileSource(wasmModule.FS, source);
            mounted.add(region);
            newlyMounted = true;
        }

        if (!valhallaRouter || newlyMounted) {
            valhallaRouter = new wasmModule.ValhallaRouter(JSON.stringify(getValhallaConfig()));
        }

        opts.onProgress?.('Computing route…');
        return performRouting(valhallaRouter, start, end);
    };
}
