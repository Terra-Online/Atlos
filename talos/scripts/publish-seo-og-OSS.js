import OSS from 'ali-oss';
import crypto from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import { getDeployChannel, resolveDeployPrefix } from './release-channel.js';
import {
  acknowledgeSeoOgPublishEntries,
  completeSeoOgFullVerification,
  readSeoOgPublishQueue,
} from './seo-og-publish-queue.js';

const config = JSON.parse(fs.readFileSync('./config/config.json', 'utf-8'));
const { region, bucket, accessKeyId, accessKeySecret, prefix: basePrefix } = config.web.build.oss;
const deployChannel = getDeployChannel();
const { prefix, source: prefixSource } = resolveDeployPrefix({
  basePrefix,
  channel: deployChannel,
  target: 'oss',
  deployChannels: config?.web?.build?.deployChannels,
});

const OSS_OG_VARIANT = 'oss';
const localDir = path.resolve(process.cwd(), process.env.SEO_OG_OUTPUT_DIR || `../seo-og/${OSS_OG_VARIANT}`);
const remoteBase = [
  prefix.replace(/^\/+|\/+$/g, ''),
  'seo/og',
  OSS_OG_VARIANT,
].filter(Boolean).join('/');
const requestedConcurrency = Number.parseInt(process.env.SEO_OG_UPLOAD_CONCURRENCY || '40', 10);
const concurrency = Number.isFinite(requestedConcurrency) && requestedConcurrency > 0
  ? requestedConcurrency
  : 40;
const verboseSkips = process.env.PUBLISH_VERBOSE_SKIPS === '1';
const forceFullVerification = process.env.SEO_OG_FORCE_VERIFY === '1';
const publishStartedAt = Date.now();
const OG_CACHE_CONTROL = 'public, max-age=3600, must-revalidate';

console.log(
  `[publish-seo-og-OSS] channel=${deployChannel} prefix=${prefix || '/'} source=${prefixSource}`,
);
console.log(`[publish-seo-og-OSS] local=${path.relative(process.cwd(), localDir) || '.'}`);
console.log(`[publish-seo-og-OSS] remote=${remoteBase || 'seo/og'}/`);
console.log(`[publish-seo-og-OSS] variant=${OSS_OG_VARIANT}`);

const client = new OSS({
  region,
  accessKeyId,
  accessKeySecret,
  authorizationV4: true,
  bucket,
  timeout: 120000,
  agent: undefined,
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

const getRemoteObjectInfo = async (objectKey) => {
  try {
    const result = await client.getObjectMeta(objectKey);
    const headers = result?.res?.headers ?? {};
    return {
      etag: normalizeEtag(headers.etag),
      size: Number.parseInt(headers['content-length'], 10) || 0,
    };
  } catch (e) {
    if (e?.status === 404 || e?.code === 'NoSuchKey' || e?.code === 'NoSuchObject') {
      return null;
    }
    throw e;
  }
};

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
    const response = await client.listV2({
      prefix: `${remoteBase}/`,
      continuationToken,
      maxKeys: 1000,
    });
    for (const item of response.objects ?? []) {
      if (!item?.name) continue;
      objects.set(item.name, {
        etag: normalizeEtag(item.etag),
        size: Number.parseInt(item.size, 10) || 0,
      });
    }
    continuationToken = response.nextContinuationToken;
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

  await client.put(objectKey, localPath, {
    headers: {
      'x-oss-storage-class': 'Standard',
      'x-oss-object-acl': 'default',
      'x-oss-forbid-overwrite': 'false',
      'Content-Type': 'image/jpeg',
      'Cache-Control': OG_CACHE_CONTROL,
    },
  });
  console.log(`${relativePath} uploaded (${(stats.size / 1024).toFixed(2)}KB)`);
}

async function deleteImages(tokens) {
  const chunkSize = 1000;
  for (let index = 0; index < tokens.length; index += chunkSize) {
    const chunk = tokens.slice(index, index + chunkSize);
    await client.deleteMulti(
      chunk.map((token) => `${remoteBase}/${token}.jpg`),
      { quiet: true },
    );
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

    console.log(`[publish-seo-og-OSS] incremental queue: upload=${uploads.length}, delete=${deletes.length}`);
    if (uploads.length > 0) await uploadFiles(uploads, { verifyRemote: false });
    if (deletes.length > 0) await deleteImages(deletes);
    await acknowledgeSeoOgPublishEntries(localDir, queue.entries);
    console.log(`[publish-seo-og-OSS] published ${queuedEntries.length} queued changes.`);
    return;
  }

  const files = (await collectImageFiles(localDir)).sort();
  const reason = forceFullVerification
    ? 'forced by SEO_OG_FORCE_VERIFY=1'
    : queue.invalid
      ? 'queue is invalid or from an older version'
      : 'queue is not initialized';
  console.log(`[publish-seo-og-OSS] full verification: ${reason}; loading remote metadata.`);
  const remoteInfoIndex = await listRemoteImageInfo();
  console.log(`[publish-seo-og-OSS] loaded ${remoteInfoIndex.size} remote image records.`);
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
  console.log(`[publish-seo-og-OSS] verified ${files.length} local images, deleted ${staleRemoteTokens.length} stale remote images.`);
}

run()
  .then(() => {
    console.log(`[publish-seo-og-OSS] completed in ${((Date.now() - publishStartedAt) / 1000).toFixed(1)}s.`);
  })
  .catch((err) => {
    console.error('[publish-seo-og-OSS] failed');
    console.error(err);
    process.exitCode = 1;
  });
