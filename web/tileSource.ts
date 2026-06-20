// Tar index parsing + the default OPFS-backed TileSource.
//
// The routing core only depends on the TileSource interface (see types.ts), so
// you can ignore this file entirely and supply your own factory. This module is
// the reference implementation: a `<region>_routing.tar` archive stored in OPFS,
// read lazily via a SyncAccessHandle.

import type { TarEntry, TileSource } from './types';

/**
 * Parse a (possibly uncompressed) tar archive and return the index of regular
 * file entries. Handles POSIX/ustar and PAX extended headers. `read` performs a
 * synchronous read of `length` bytes at absolute offset `at` into `into`.
 *
 * NOTE: the archive must be an uncompressed `.tar`. If you store `.tar.gz`,
 * decompress before handing bytes to the routing core (browsers can do this with
 * DecompressionStream), or serve/store it uncompressed.
 */
export function parseTarIndex(
    read: (into: Uint8Array, at: number, length: number) => number,
    totalSize: number,
): TarEntry[] {
    const BLOCK_SIZE = 512;
    const headerBuf = new Uint8Array(BLOCK_SIZE);
    const entries: TarEntry[] = [];
    const decoder = new TextDecoder();

    let pos = 0;
    let paxName: string | null = null;

    while (pos + BLOCK_SIZE <= totalSize) {
        read(headerBuf, pos, BLOCK_SIZE);

        // Detect the end-of-archive zero block.
        let allZero = true;
        for (let i = 0; i < BLOCK_SIZE; i++) {
            if (headerBuf[i] !== 0) { allZero = false; break; }
        }
        if (allZero) {
            pos += BLOCK_SIZE;
            continue;
        }

        const nameRaw = decoder.decode(headerBuf.subarray(0, 100)).replace(/\0+$/, '');
        const sizeOctal = decoder.decode(headerBuf.subarray(124, 136)).replace(/\0+$/, '').trim();
        const typeflag = String.fromCharCode(headerBuf[156]);
        const prefix = decoder.decode(headerBuf.subarray(345, 500)).replace(/\0+$/, '');

        const fileSize = parseInt(sizeOctal, 8) || 0;
        const dataOffset = pos + BLOCK_SIZE;
        const dataBlocks = Math.ceil(fileSize / BLOCK_SIZE);

        if (typeflag === 'x' || typeflag === 'g') {
            // PAX extended header — read it to recover a long filename.
            if (fileSize > 0 && fileSize < 65536) {
                const paxBuf = new Uint8Array(fileSize);
                read(paxBuf, dataOffset, fileSize);
                const pathMatch = decoder.decode(paxBuf).match(/\d+ path=(.+)\n/);
                if (pathMatch) paxName = pathMatch[1];
            }
            pos = dataOffset + dataBlocks * BLOCK_SIZE;
            continue;
        }

        if (typeflag === '0' || typeflag === '\0' || typeflag === '') {
            let fullName = prefix ? `${prefix}/${nameRaw}` : nameRaw;
            if (paxName) { fullName = paxName; paxName = null; }
            if (fileSize > 0) entries.push({ name: fullName, offset: dataOffset, size: fileSize });
        } else {
            // Directory ('5') or other entry type — skip.
            paxName = null;
        }

        pos = dataOffset + dataBlocks * BLOCK_SIZE;
    }

    return entries;
}

/**
 * Default TileSourceFactory: reads `<dir>/<region>_routing.tar` from OPFS via a
 * SyncAccessHandle (synchronous random reads, available inside a Web Worker).
 *
 * `dir` defaults to "offline_maps". You are responsible for populating OPFS with
 * the tar files beforehand (download + write); this factory only reads them.
 *
 * The SyncAccessHandle is intentionally kept open for the lifetime of the worker
 * so tiles can be read on demand; it is released when the worker is terminated.
 */
export function createOpfsTarTileSourceFactory(dir = 'offline_maps') {
    return async function opfsTarTileSource(region: string): Promise<TileSource | null> {
        try {
            const rootDir = await navigator.storage.getDirectory();
            const mapDir = await rootDir.getDirectoryHandle(dir, { create: false });
            const fileHandle = await mapDir.getFileHandle(`${region}_routing.tar`, { create: false });
            // @ts-expect-error createSyncAccessHandle is worker-only and not in all lib.dom versions
            const handle: FileSystemSyncAccessHandle = await fileHandle.createSyncAccessHandle();

            const totalSize = handle.getSize();
            const read = (into: Uint8Array, at: number, _length: number) => handle.read(into, { at });
            const entries = parseTarIndex(read, totalSize);

            return { entries, read };
        } catch (e) {
            console.warn(`[valhalla-wasm] No tile source for region "${region}"`, e);
            return null;
        }
    };
}
