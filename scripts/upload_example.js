#!/usr/bin/env node
// EXAMPLE ONLY — uploading built tiles to S3-compatible object storage.
//
// This is one way to serve tiles to clients; it is NOT required to use the
// worker. The worker reads tiles from wherever you put them (OPFS, native FS,
// HTTP, a bundle). Adapt or delete this file. No defaults point at any specific
// account or bucket — everything comes from the environment.
//
// Env:
//   S3_ENDPOINT        e.g. https://<account>.r2.cloudflarestorage.com (omit for AWS S3)
//   S3_REGION          default "auto"
//   S3_BUCKET          target bucket (required)
//   S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY   credentials (required)
//   IN_DIR             directory of built tiles (default ./build)
//
// Install the SDK first:  npm i @aws-sdk/client-s3
//
// IMPORTANT: if you upload gzipped tiles (`*_routing.tar.gz`), set
// ContentEncoding: 'gzip' so browsers transparently decompress on download and
// the client stores the plain `.tar` the worker expects. Uploading uncompressed
// `.tar` files needs no special metadata.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN_DIR = path.resolve(process.env.IN_DIR || path.join(__dirname, 'build'));
const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
const S3_REGION = process.env.S3_REGION || 'auto';

if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    console.error('❌ Set S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (and S3_ENDPOINT for non-AWS).');
    process.exit(1);
}

const s3 = new S3Client({
    region: S3_REGION,
    endpoint: S3_ENDPOINT || undefined,
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
});

async function main() {
    const files = fs.existsSync(IN_DIR)
        ? fs.readdirSync(IN_DIR).filter((f) => f.endsWith('_routing.tar') || f.endsWith('_routing.tar.gz'))
        : [];
    if (files.length === 0) { console.log(`No tile archives in ${IN_DIR}. Run build_tiles.js first.`); return; }

    for (const file of files) {
        const isGzip = file.endsWith('.gz');
        console.log(`Uploading ${file}…`);
        await s3.send(new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: file,
            Body: fs.createReadStream(path.join(IN_DIR, file)),
            ContentType: 'application/x-tar',
            ...(isGzip ? { ContentEncoding: 'gzip' } : {}),
        }));
        console.log(`✅ ${file}`);
    }
    console.log('🎉 Upload complete.');
}

main().catch((e) => { console.error(e); process.exit(1); });
