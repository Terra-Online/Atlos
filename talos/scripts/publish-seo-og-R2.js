import {
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import crypto from 'node:crypto';
import fs from 'fs-extra';
import https from 'node:https';
import path from 'node:path';
import { getDeployChannel, resolveDeployPrefix } from './release-channel.js';
import {
  acknowledgeSeoOgPublishEntries,
  completeSeoOgFullVerification,
  readSeoOgPublishQueue,
} from './seo-og-publish-queue.js';

const config = JSON.parse(fs.readFileSync('./config/config.r2.json', 'utf-8'));
const { endpoint, bucket, region, prefix: basePrefix, accessKeyId, accessKeySecret } =
  config.web.build.r2;
const deployChannel = getDeployChannel();
const { prefix, source: prefixSource } = resolveDeployPrefix({
  basePrefix,
  channel: deployChannel,
  target: 'r2',
  deployChannels: config?.web?.build?.deployChannels,
});

const R2_OG_VARIANT = 'r2';
const localDir = path.resolve(process.cwd(), process.env.SEO_OG_OUTPUT_DIR || `../seo-og/${R2_OG_VARIANT}`);
const remoteBase = [
  prefix.replace(/^\/+|\/+$/g, ''),
  'seo/og',
  R2_OG_VARIANT,
].filter(Boolean).join('/');
const requestedConcurrency = Number.parseInt(process.env.SEO_OG_UPLOAD_CONCURRENCY || '120', 10);
const concurrency = Number.isFinite(requestedConcurrency) && requestedConcurrency > 0
  ? requestedConcurrency
  : 120;
const requestedMaxSockets = Number.parseInt(process.env.SEO_OG_MAX_SOCKETS || '', 10);
const maxSockets = Number.isFinite(requestedMaxSockets) && requestedMaxSockets > 0
  ? requestedMaxSockets
  : concurrency;
const verboseSkips = process.env.PUBLISH_VERBOSE_SKIPS === '1';
const forceFullVerification = process.env.SEO_OG_FORCE_VERIFY === '1';
const publishStartedAt = Date.now();
const OG_CACHE_CONTROL = 'public, max-age=3600, must-revalidate';

console.log(
  `[publish-seo-og-R2] channel=${deployChannel} prefix=${prefix || '/'} source=${prefixSource}`
);
console.log(`[publish-seo-og-R2] local=${path.relative(process.cwd(), localDir) || '.'}`);
console.log(`[publish-seo-og-R2] remote=${remoteBase || 'seo/og'}/`);
console.log(`[publish-seo-og-R2] variant=${R2_OG_VARIANT}`);

const client = new S3Client({
  region: region || 'auto',
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId,
    secretAccessKey: accessKeySecret,
  },
  requestHandler: new NodeHttpHandler({
    httpsAgent: new https.Agent({ keepAlive: true, maxSockets }),
  }),
});

const normalizeEtag = (etag) =>
  String(etag ?? '').replace(/^"|"$/g, '').toLowerCase();

const calculateFileMd5 = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });

async function getRemoteObjectInfo(objectKey) {
  try {
    const result = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: objectKey,
      }),
    );
    return {
      etag: normalizeEtag(result.ETag),
      size: result.ContentLength ?? 0,
    };
  } catch (e) {
    const status = e?.$metadata?.httpStatusCode;
    if (status === 404 || e?.name === 'NotFound' || e?.Code === 'NoSuchKey') {
      return null;
    }
    throw e;
  }
}

async function shouldSkipUpload(localPath, objectKey, fileSize, knownRemote) {
  const [localEtag, remote] = await Promise.all([
    calculateFileMd5(localPath),
    knownRemote === undefined ? getRemoteObjectInfo(objectKey) : knownRemote,
  ]);
  return Boolean(remote && remote.size === fileSize && remote.etag === localEtag);
}

async function listRemoteImageInfo() {
  const objects = new Map();
  let continuationToken;
  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `${remoteBase}/`,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    }));
    for (const item of response.Contents ?? []) {
      if (!item.Key) continue;
      objects.set(item.Key, {
        etag: normalizeEtag(item.ETag),
        size: item.Size ?? 0,
      });
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);
  return objects;
}

async function collectImageFiles(dir, baseDir = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectImageFiles(fullPath, baseDir));
      continue;
    }
    if (!entry.isFile() || !/^[0-9a-zA-Z]{7}\.jpg$/.test(entry.name)) continue;
    files.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'));
  }
  return files;
}

async function uploadImage(relativePath, { verifyRemote = true, remoteInfoIndex } = {}) {
  const localPath = path.join(localDir, relativePath);
  const objectKey = [remoteBase, relativePath].filter(Boolean).join('/');
  const stats = await fs.stat(localPath);

  const knownRemote = remoteInfoIndex
    ? remoteInfoIndex.get(objectKey) ?? null
    : undefined;
  if (verifyRemote && await shouldSkipUpload(localPath, objectKey, stats.size, knownRemote)) {
    if (verboseSkips) console.log(`${relativePath} skipped`);
    return;
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: fs.createReadStream(localPath),
      ContentType: 'image/jpeg',
      CacheControl: OG_CACHE_CONTROL,
    }),
  );
  console.log(`${relativePath} uploaded (${(stats.size / 1024).toFixed(2)}KB)`);
}

async function deleteImages(tokens) {
  const chunkSize = 1000;
  for (let index = 0; index < tokens.length; index += chunkSize) {
    const chunk = tokens.slice(index, index + chunkSize);
    await client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: chunk.map((token) => ({ Key: `${remoteBase}/${token}.jpg` })),
        Quiet: true,
      },
    }));
  }
}

async function uploadFiles(files, options) {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, files.length)) },
    async () => {
      while (cursor < files.length) {
        const file = files[cursor++];
        await uploadImage(file, options);
      }
    },
  );
  await Promise.all(workers);
}

async function run() {
  if (!(await fs.pathExists(localDir))) {
    throw new Error(`SEO OG image directory does not exist: ${localDir}`);
  }

  const queue = await readSeoOgPublishQueue(localDir);
  const shouldVerifyAll = forceFullVerification || queue.requiresFullVerification;
  if (!shouldVerifyAll) {
    const queuedEntries = Object.entries(queue.entries);
    const uploads = queuedEntries
      .filter(([, entry]) => entry.action === 'upload')
      .map(([token]) => `${token}.jpg`);
    const deletes = queuedEntries
      .filter(([, entry]) => entry.action === 'delete')
      .map(([token]) => token);

    console.log(`[publish-seo-og-R2] incremental queue: upload=${uploads.length}, delete=${deletes.length}`);
    if (uploads.length > 0) await uploadFiles(uploads, { verifyRemote: false });
    if (deletes.length > 0) await deleteImages(deletes);
    await acknowledgeSeoOgPublishEntries(localDir, queue.entries);
    console.log(`[publish-seo-og-R2] published ${queuedEntries.length} queued changes.`);
    return;
  }

  const files = (await collectImageFiles(localDir)).sort();
  const reason = forceFullVerification
    ? 'forced by SEO_OG_FORCE_VERIFY=1'
    : queue.invalid
      ? 'queue is invalid or from an older version'
      : 'queue is not initialized';
  console.log(`[publish-seo-og-R2] full verification: ${reason}; loading remote metadata.`);
  const remoteInfoIndex = await listRemoteImageInfo();
  console.log(`[publish-seo-og-R2] loaded ${remoteInfoIndex.size} remote image records.`);
  if (files.length === 0 && remoteInfoIndex.size > 0) {
    throw new Error('Local SEO OG directory contains no images; refusing to delete all remote images.');
  }
  await uploadFiles(files, { verifyRemote: true, remoteInfoIndex });
  const localTokens = new Set(files.map((file) => path.basename(file, '.jpg')));
  const remoteTokens = [...remoteInfoIndex.keys()]
    .filter((key) => key.startsWith(`${remoteBase}/`) && key.endsWith('.jpg'))
    .map((key) => key.slice(remoteBase.length + 1, -4))
    .filter((token) => /^[0-9a-zA-Z]{7}$/.test(token));
  const staleRemoteTokens = remoteTokens.filter((token) => !localTokens.has(token));
  if (staleRemoteTokens.length > 0) await deleteImages(staleRemoteTokens);
  await completeSeoOgFullVerification(localDir, queue.entries);
  console.log(`[publish-seo-og-R2] verified ${files.length} local images, deleted ${staleRemoteTokens.length} stale remote images.`);
}

run()
  .then(() => {
    console.log(`[publish-seo-og-R2] completed in ${((Date.now() - publishStartedAt) / 1000).toFixed(1)}s.`);
  })
  .catch((err) => {
    console.error('[publish-seo-og-R2] failed');
    console.error(err);
    process.exitCode = 1;
  });
