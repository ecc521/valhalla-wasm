// Public types for the Valhalla-WASM browser routing engine.

/** A routing request sent to the worker. Coordinates are [lng, lat] (GeoJSON order). */
export interface RoutingRequest {
    start: [number, number];
    end: [number, number];
    /**
     * Which tile regions to mount for this request, e.g. ["US-CO", "US-WY"].
     * Each id is resolved to a tile source by the configured TileSourceFactory.
     */
    regions: string[];
}

export interface RoutingInstruction {
    text: string;
    distance: number; // miles
    time: number;     // seconds
    type: number;     // Valhalla maneuver type (useful for picking turn icons)
}

export interface RoutingSummary {
    distance: number; // total miles
    time: number;     // total seconds
}

export interface RoutingResponse {
    success: boolean;
    geometry?: GeoJSON.LineString; // the route path, [lng, lat] coordinates
    instructions?: RoutingInstruction[];
    summary?: RoutingSummary;
    error?: string;
    /** Progress updates emitted before the final response (success is false on these). */
    progress?: string;
}

/** One regular-file entry discovered inside a tar archive. */
export interface TarEntry {
    name: string;
    offset: number; // byte offset of the file's data within the source
    size: number;   // file size in bytes
}

/**
 * A storage-agnostic source of Valhalla routing tiles for a single region.
 *
 * The routing core mounts each entry as a lazily-read virtual file in the WASM
 * filesystem, then asks for bytes on demand. Reads MUST be synchronous because
 * Emscripten's filesystem read op is synchronous — back this with something that
 * supports sync random reads (OPFS SyncAccessHandle, an in-memory buffer, etc.).
 */
export interface TileSource {
    /** The tiles available in this source (typically a parsed tar index). */
    entries: TarEntry[];
    /**
     * Read `length` bytes starting at `at` (absolute offset in the source) into
     * `buffer` at position 0. Returns the number of bytes actually read.
     */
    read(buffer: Uint8Array, at: number, length: number): number;
}

/**
 * Resolves a region id (e.g. "US-CO") to a TileSource. Implement this over
 * whatever storage you use — OPFS, the Capacitor/native filesystem, HTTP range
 * requests, IndexedDB, a bundled buffer, etc. Return null if the region is not
 * available (e.g. not downloaded yet).
 */
export type TileSourceFactory = (region: string) => Promise<TileSource | null>;
