#!/usr/bin/env node
// Build Valhalla routing tiles for a set of regions and archive each as an
// uncompressed `<id>_routing.tar` (the format the browser worker reads).
//
// Usage:
//   node build_tiles.js                 # uses ./regions.example.json
//   node build_tiles.js my-regions.json
//   OUT_DIR=./out CONCURRENCY=4 node build_tiles.js my-regions.json
//
// Requires Docker. Uses the public gis-ops Valhalla image for the CLI tools, so
// you do NOT need Valhalla installed locally. OSM extracts are pulled from
// Geofabrik. This is a REFERENCE pipeline — adapt the region list and storage to
// your needs.
//
// regions JSON format: [{ "id": "US-CO", "geofabrik": "north-america/us/colorado-latest.osm.pbf" }, ...]

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const execAsync = util.promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VALHALLA_IMAGE = process.env.VALHALLA_IMAGE || 'ghcr.io/gis-ops/docker-valhalla/valhalla:latest';
const OUT_DIR = path.resolve(process.env.OUT_DIR || path.join(__dirname, 'build'));
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '4', 10);
const GZIP = process.argv.includes('--gzip');

const regionsFile = path.resolve(process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[2]
    : path.join(__dirname, 'regions.example.json'));

try {
    execSync('docker --version', { stdio: 'ignore' });
} catch (_e) {
    console.error('❌ Docker is required (it provides the Valhalla CLI tools). Install Docker and retry.');
    process.exit(1);
}

const regions = JSON.parse(fs.readFileSync(regionsFile, 'utf8'));
fs.mkdirSync(OUT_DIR, { recursive: true });

async function run(cmd) {
    const { stderr } = await execAsync(cmd, { maxBuffer: 1024 * 1024 * 64 });
    return stderr;
}

async function processRegion(region) {
    const { id, geofabrik } = region;
    console.log(`\n=== ${id} ===`);
    const pbf = path.join(OUT_DIR, `${id}.osm.pbf`);
    const tileDir = path.join(OUT_DIR, `${id}_valhalla`);
    const configPath = path.join(OUT_DIR, `${id}_valhalla.json`);
    const tar = path.join(OUT_DIR, `${id}_routing.tar`);

    // 1. Download OSM extract.
    if (!fs.existsSync(pbf)) {
        console.log(`[1/4] ${id} downloading OSM extract…`);
        await run(`curl -sS -L -o "${pbf}" "https://download.geofabrik.de/${geofabrik}"`);
    } else {
        console.log(`[1/4] ${id} OSM extract already present.`);
    }

    // 2. Generate + slim the Valhalla config (driving only).
    fs.mkdirSync(tileDir, { recursive: true });
    console.log(`[2/4] ${id} generating config…`);
    await run(`docker run --rm -v "${OUT_DIR}:/custom_files" --entrypoint valhalla_build_config ${VALHALLA_IMAGE} --mjolnir-tile-dir /custom_files/${id}_valhalla --mjolnir-tile-extract /custom_files/${id}_valhalla/valhalla_tiles.tar --mjolnir-timezone /custom_files/${id}_valhalla/tz_world.sqlite --mjolnir-admin /custom_files/${id}_valhalla/admins.sqlite > "${configPath}"`);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.mjolnir) { config.mjolnir.include_bicycle = false; config.mjolnir.include_pedestrian = false; }
    if (config.additional_data?.elevation) config.additional_data.elevation = '';
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // 3. Build the routing graph (heavy).
    console.log(`[3/4] ${id} building routing graph…`);
    await run(`docker run --rm -v "${OUT_DIR}:/custom_files" --entrypoint valhalla_build_tiles ${VALHALLA_IMAGE} -c /custom_files/${id}_valhalla.json /custom_files/${id}.osm.pbf`);

    // 4. Archive as an uncompressed tar (what the worker reads). COPYFILE_DISABLE
    //    + --exclude prevent macOS resource-fork (._*) files leaking in.
    console.log(`[4/4] ${id} archiving → ${path.basename(tar)}`);
    await run(`cd "${tileDir}" && export COPYFILE_DISABLE=1 && tar -cf "${tar}" --exclude='._*' *`);
    if (GZIP) {
        await run(`gzip -9 -f "${tar}"`);
        console.log(`     gzipped → ${path.basename(tar)}.gz (serve with Content-Encoding: gzip so the browser stores the plain .tar)`);
    }
    console.log(`✅ ${id} done.`);
}

async function main() {
    console.log(`Building ${regions.length} region(s) → ${OUT_DIR} (concurrency ${CONCURRENCY})`);
    let i = 0;
    const worker = async () => {
        while (i < regions.length) {
            const region = regions[i++];
            try { await processRegion(region); }
            catch (err) { console.error(`❌ ${region.id} failed:`, err.message || err); }
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
    console.log('\n🎉 Done. The `<id>_routing.tar` files are ready to serve/store for the worker.');
}

main().catch(console.error);
