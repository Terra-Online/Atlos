import OSS from 'ali-oss';
import { execFileSync } from 'node:child_process';
import fs from "fs-extra";
import path from "path";
import crypto from "crypto";
import { getDeployChannel, resolveDeployPrefix } from "./release-channel.js";
import { buildClipIndex, normalizeObjectKey, toPrefixedObjectKey } from './tile-index.js';

const distDir = path.resolve(process.cwd(), process.env.DIST_DIR || 'dist/oss');
const appPath = process.env.PUBLISH_APP_PATH || '';
if (appPath && !['intel', 'me'].includes(appPath)) throw new Error('Invalid PUBLISH_APP_PATH');
const publishStartedAt = Date.now();

const config = JSON.parse(fs.readFileSync('./config/config.json', 'utf-8'));
const { region, bucket, accessKeyId, accessKeySecret, prefix: basePrefix } = config.web.build.oss
const deployChannel = getDeployChannel();
const { prefix, source: prefixSource } = resolveDeployPrefix({
  basePrefix,
  channel: deployChannel,
  target: 'oss',
  deployChannels: config?.web?.build?.deployChannels,
});

console.log(
  `[publish-oss] channel=${deployChannel} prefix=${prefix || '/'} source=${prefixSource}`
);
console.log(`[publish-oss] distDir=${path.relative(process.cwd(), distDir) || '.'}`);

const client = new OSS({
  region,
  accessKeyId,
  accessKeySecret,
  authorizationV4: true,
  bucket,
  timeout: 120000, // 2 minutes
  agent: undefined, // 禁用连接池,避免callback twice
});

/**
 * Cache-Control strategy:
 * - assets/**  (hashed filenames)  → immutable, 1 year
 * - files/**   (archive HTML)      → public, 1 week
 * - *.html     (app shell)         → no-store, always revalidate
 * - everything else                → public, 1 hour
 */
const getCacheControl = (relativePath) => {
  const p = relativePath.replace(/\\/g, '/');
  if (p.startsWith('assets/')) return 'public, max-age=31536000, immutable';
  if (p.startsWith('files/'))  return 'public, max-age=604800';
  if (p.endsWith('.html'))     return 'no-cache, no-store, must-revalidate';
  return 'public, max-age=3600';
};

function getAllFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);

  arrayOfFiles = arrayOfFiles || [];

  files.forEach(function (file) {
    if (file === '.DS_Store') return;
    if (fs.statSync(path.join(dirPath, file)).isDirectory()) {
      arrayOfFiles = getAllFiles(path.join(dirPath, file), arrayOfFiles);
    } else {
      const relativePath = path.relative(distDir, path.join(dirPath, file));
      arrayOfFiles.push(relativePath);
    }
  });

  return arrayOfFiles;
}

const remoteObjectListPromiseMap = new Map();

const fetchRemoteObjects = async (prefixToList) => {
  const remoteObjects = [];
  let continuationToken;

  do {
    const response = await client.listV2({
      prefix: prefixToList,
      continuationToken,
      maxKeys: 1000,
    });

    const objects = response.objects || [];
    for (const item of objects) {
      if (item?.name) {
        remoteObjects.push({
          key: item.name,
          lastModified: item.lastModified,
          etag: String(item.etag ?? '').replace(/^"|"$/g, '').toLowerCase(),
          size: Number.parseInt(item.size, 10) || 0,
        });
      }
    }

    continuationToken = response.nextContinuationToken;
  } while (continuationToken);

  return remoteObjects;
};

const listRemoteObjects = (prefixToList) => {
  if (!remoteObjectListPromiseMap.has(prefixToList)) {
    remoteObjectListPromiseMap.set(prefixToList, fetchRemoteObjects(prefixToList));
  }
  return remoteObjectListPromiseMap.get(prefixToList);
};

const listRemoteObjectKeys = async (prefixToList) =>
  (await listRemoteObjects(prefixToList)).map((object) => object.key);

const deleteRemoteObjectKeys = async (keys) => {
  if (!keys.length) return;

  const chunkSize = 1000;
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize);
    await client.deleteMulti(chunk, { quiet: true });
  }
};

// Keep search index docs as single PUT objects so OSS ETag remains the file MD5.
const MULTIPART_THRESHOLD = 64 * 1024 * 1024;
const MAX_RETRIES = 3;
const verboseSkips = process.env.PUBLISH_VERBOSE_SKIPS === '1';
const shouldUploadSeoPointAliases = process.env.SEO_UPLOAD_POINT_ALIASES !== '0';
const seoPointAliasConcurrency = Number.parseInt(process.env.SEO_POINT_ALIAS_CONCURRENCY || '100', 10);
const seoPointTarget = 'oss';
const targetSeoPointPrefix = `seo/points/${seoPointTarget}/`;
const targetSeoPointHtmlPattern = new RegExp(`^${targetSeoPointPrefix}[0-9a-zA-Z]{7}\\.html$`);
const assetPruneRetentionDaysRaw = Number.parseInt(process.env.ASSET_PRUNE_RETENTION_DAYS || '14', 10);
const assetPruneRetentionDays = Number.isFinite(assetPruneRetentionDaysRaw)
  ? Math.max(0, assetPruneRetentionDaysRaw)
  : 14;
const assetPruneRetentionMs = assetPruneRetentionDays * 24 * 60 * 60 * 1000;

console.log(`[publish-oss] assetPruneRetentionDays=${assetPruneRetentionDays}`);

const shouldUploadLocalFile = (relativePath) => {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  if (appPath) return normalizedPath.startsWith(`${appPath}/`);
  if (normalizedPath.startsWith('seo/points/') && !normalizedPath.startsWith(targetSeoPointPrefix)) {
    return false;
  }
  return true;
};

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

const shouldSkipUpload = async (
  relativePath,
  objectKey,
  localPath,
  fileSize,
  remoteObjectInfoIndex,
) => {
  const remote = remoteObjectInfoIndex
    ? remoteObjectInfoIndex.get(normalizeObjectKey(objectKey)) ?? null
    : await getRemoteObjectInfo(objectKey);

  if (!remote) return false;

  if (remote.size !== fileSize) {
    console.log(
      `${relativePath} changed, uploading (remote size=${remote.size}; local size=${fileSize})`
    );
    return false;
  }

  const localEtag = await calculateFileMd5(localPath);

  if (remote.etag === localEtag) {
    if (verboseSkips) console.log(`${relativePath} skipped (same ETag ${localEtag})`);
    return true;
  }

  console.log(
    `${relativePath} changed, uploading (remote size=${remote.size}, etag=${remote.etag || '-'}; local size=${fileSize}, etag=${localEtag})`
  );
  return false;
};

const upload = async (relativePath, retryCount = 0, remoteObjectInfoIndex) => {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  const cleanPrefix = prefix.replace(/^\/+/, '').replace(/\/+$/, '');
  const objectKey = cleanPrefix ? `${cleanPrefix}/${normalizedPath}` : normalizedPath;
  const localPath = path.resolve(distDir, relativePath);
  
  const headers = {
    'x-oss-storage-class': 'Standard',
    'x-oss-object-acl': 'default',
    'x-oss-forbid-overwrite': 'false',
    'Cache-Control': getCacheControl(relativePath),
  };

  try {
    const stats = fs.statSync(localPath);
    const fileSize = stats.size;

    if (await shouldSkipUpload(
      relativePath,
      objectKey,
      localPath,
      fileSize,
      remoteObjectInfoIndex,
    )) {
      return;
    }
    
    // huge file upload
    if (fileSize > MULTIPART_THRESHOLD) {
      await client.multipartUpload(objectKey, localPath, {
        headers,
        partSize: 2 * 1024 * 1024, // 2MB per part (reduce part quantity)
        parallel: 100, // 100 parts upload concurrency
      });
      console.log(`${relativePath} uploaded (multipart, ${(fileSize / 1024 / 1024).toFixed(2)}MB)`);
    } else {
      // small file upload
      await client.put(objectKey, localPath, { headers });
      console.log(`${relativePath} uploaded (${(fileSize / 1024).toFixed(2)}KB)`);
    }
  } catch (e) {
    // retry logic
    if (retryCount < MAX_RETRIES) {
      const waitTime = 2000 * Math.pow(2, retryCount); // 2s, 4s, 8s
      console.warn(`Retry ${retryCount + 1}/${MAX_RETRIES} after ${waitTime}ms: ${relativePath}`);
      await new Promise(r => setTimeout(r, waitTime));
      return upload(relativePath, retryCount + 1, remoteObjectInfoIndex);
    }
    console.error(`Upload failed after ${MAX_RETRIES} retries: ${relativePath}`, e?.name || e?.code || e?.message || e);
    throw e;
  }
}

const uploadAlias = async (sourceRelativePath, aliasRelativePath, retryCount = 0) => {
  const cleanPrefix = prefix.replace(/^\/+/, '').replace(/\/+$/, '');
  const normalizedAliasPath = aliasRelativePath.replace(/\\/g, '/');
  const objectKey = cleanPrefix ? `${cleanPrefix}/${normalizedAliasPath}` : normalizedAliasPath;
  const localPath = path.resolve(distDir, sourceRelativePath);

  const headers = {
    'x-oss-storage-class': 'Standard',
    'x-oss-object-acl': 'default',
    'x-oss-forbid-overwrite': 'false',
    'Cache-Control': getCacheControl(aliasRelativePath),
  };

  try {
    const stats = fs.statSync(localPath);
    const fileSize = stats.size;
    if (await shouldSkipUpload(aliasRelativePath, objectKey, localPath, fileSize)) {
      return;
    }
    await client.put(objectKey, localPath, { headers });
    console.log(`${sourceRelativePath} aliased as ${aliasRelativePath} (${(fileSize / 1024).toFixed(2)}KB)`);
  } catch (e) {
    if (retryCount < MAX_RETRIES) {
      const waitTime = 2000 * Math.pow(2, retryCount);
      console.warn(`Retry alias ${retryCount + 1}/${MAX_RETRIES} after ${waitTime}ms: ${aliasRelativePath}`);
      await new Promise(r => setTimeout(r, waitTime));
      return uploadAlias(sourceRelativePath, aliasRelativePath, retryCount + 1);
    }
    console.error(`Alias upload failed after ${MAX_RETRIES} retries: ${aliasRelativePath}`, e?.name || e?.code || e?.message || e);
    throw e;
  }
};

const uploadSeoPointAliases = async (localFiles) => {
  const seoPointFiles = localFiles
    .map((relativePath) => relativePath.replace(/\\/g, '/'))
    .filter((relativePath) => targetSeoPointHtmlPattern.test(relativePath));

  if (!seoPointFiles.length) return;

  const workerCount = Math.max(
    1,
    Math.min(Number.isFinite(seoPointAliasConcurrency) ? seoPointAliasConcurrency : 20, seoPointFiles.length)
  );
  let cursor = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < seoPointFiles.length) {
      const relativePath = seoPointFiles[cursor++];
      const token = path.basename(relativePath, '.html');
      await uploadAlias(relativePath, `${token}/index.html`);
    }
  });

  await Promise.all(workers);
};

const requestedConcurrency = Number.parseInt(process.env.OSS_UPLOAD_CONCURRENCY || '40', 10);
const concurrency = Number.isFinite(requestedConcurrency) && requestedConcurrency > 0
  ? requestedConcurrency
  : 40;

const getRemoteListRelativePrefix = (relativePath) => {
  const segments = relativePath.replace(/\\/g, '/').split('/');
  if (segments.length < 2) return null;
  const depth = segments[0] === 'seo' && segments[1] === 'points' ? 3 : 1;
  return `${segments.slice(0, depth).join('/')}/`;
};

const buildRemoteObjectInfoIndex = async (localFiles) => {
  const startedAt = Date.now();
  const relativePrefixes = new Set(
    localFiles.map(getRemoteListRelativePrefix).filter(Boolean),
  );
  const objectGroups = await Promise.all(
    [...relativePrefixes].map((relativePrefix) =>
      listRemoteObjects(toPrefixedObjectKey(prefix, relativePrefix))
    ),
  );
  const index = new Map();
  objectGroups.flat().forEach((object) => {
    index.set(normalizeObjectKey(object.key), object);
  });
  console.log(
    `[publish-oss] loaded ${index.size} remote object records from ${relativePrefixes.size} prefixes in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`
  );
  return index;
};

const reconcileClipObjects = async (expectedClipFiles) => {
  const clipPrefix = toPrefixedObjectKey(prefix, 'clips/');
  const remoteClipKeys = await listRemoteObjectKeys(clipPrefix);

  const expectedSet = new Set(
    expectedClipFiles.map((relativePath) => toPrefixedObjectKey(prefix, relativePath))
  );

  const staleKeys = remoteClipKeys.filter((key) => !expectedSet.has(normalizeObjectKey(key)));

  if (!staleKeys.length) {
    console.log('[publish-oss] clips directory already consistent with index.');
    return;
  }

  await deleteRemoteObjectKeys(staleKeys);
  console.log(`[publish-oss] deleted ${staleKeys.length} stale clips objects.`);
};

const reconcileAssetObjects = async (localFiles) => {
  if (appPath) return;
  if (!(await fs.pathExists(path.resolve(distDir, 'assets')))) {
    console.log('[publish-oss] assets directory skipped: assets does not exist in dist.');
    return;
  }

  const assetPrefix = toPrefixedObjectKey(prefix, 'assets/');
  const remoteAssetObjects = await listRemoteObjects(assetPrefix);

  const expectedSet = new Set(
    localFiles
      .filter((relativePath) => relativePath.replace(/\\/g, '/').startsWith('assets/'))
      .map((relativePath) => toPrefixedObjectKey(prefix, relativePath))
  );

  const staleObjects = remoteAssetObjects.filter((object) => !/(?:^|\/)assets\/fonts\/shards\//.test(normalizeObjectKey(object.key)) && !expectedSet.has(normalizeObjectKey(object.key)));

  if (!staleObjects.length) {
    console.log('[publish-oss] assets directory already consistent with local dist.');
    return;
  }

  const cutoffMs = Date.now() - assetPruneRetentionMs;
  const staleKeysToDelete = staleObjects
    .filter((object) => {
      if (assetPruneRetentionMs === 0) return true;
      const lastModifiedMs = new Date(object.lastModified).getTime();
      return Number.isFinite(lastModifiedMs) && lastModifiedMs <= cutoffMs;
    })
    .map((object) => object.key);

  if (!staleKeysToDelete.length) {
    console.log(
      `[publish-oss] retained ${staleObjects.length} stale assets younger than ${assetPruneRetentionDays} days.`
    );
    return;
  }

  await deleteRemoteObjectKeys(staleKeysToDelete);
  console.log(
    `[publish-oss] deleted ${staleKeysToDelete.length} stale assets objects, retained ${staleObjects.length - staleKeysToDelete.length}.`
  );
};

const uploadExternalSeoOgImages = async () => {
  if (process.env.SEO_SKIP_OG_UPLOAD === '1') {
    console.log('[publish-oss] SEO OG image upload skipped by SEO_SKIP_OG_UPLOAD=1.');
    return;
  }

  const seoOgDir = path.resolve(process.cwd(), process.env.SEO_OG_OUTPUT_DIR || '../seo-og/oss');
  if (!(await fs.pathExists(seoOgDir))) {
    console.log('[publish-oss] SEO OG image upload skipped: external image directory does not exist.');
    return;
  }

  execFileSync('node', ['./scripts/publish-seo-og-OSS.js'], {
    stdio: 'inherit',
    env: { ...process.env, SEO_OG_OUTPUT_DIR: seoOgDir },
  });
};

const uploadFiles = async (files, remoteObjectInfoIndex) => {
  let cursor = 0;
  const worker = async () => {
    while (cursor < files.length) {
      const file = files[cursor++];
      await upload(file, 0, remoteObjectInfoIndex);
    }
  };
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, files.length); i++) workers.push(worker());
  await Promise.all(workers);
};

const run = async () => {
  const clipIndex = appPath
    ? { generated: false, reason: 'standalone app release preserves main-site tiles' }
    : await buildClipIndex({ distDir });
  if (clipIndex.generated) {
    console.log(
      `[publish-oss] clip index generated: tiles=${clipIndex.tileFileCount}, coverageFiles=${clipIndex.coverageFileCount}`
    );
  } else {
    console.log(`[publish-oss] clip index skipped: ${clipIndex.reason}`);
  }

  const localFiles = getAllFiles(distDir).filter(shouldUploadLocalFile);
  const htmlFiles = localFiles.filter((file) => file.replace(/\\/g, '/').endsWith('.html'));
  const shellFiles = htmlFiles.filter((file) => file.replace(/\\/g, '/') === 'index.html');
  const documentFiles = htmlFiles.filter((file) => !shellFiles.includes(file));
  const resourceFiles = localFiles.filter((file) => !htmlFiles.includes(file));
  const remoteObjectInfoIndex = await buildRemoteObjectInfoIndex(localFiles);

  await uploadFiles(resourceFiles, remoteObjectInfoIndex);

  if (clipIndex.generated) {
    await reconcileClipObjects(clipIndex.expectedClipFiles);
  }

  await reconcileAssetObjects(localFiles);

  await uploadExternalSeoOgImages();

  await uploadFiles(documentFiles, remoteObjectInfoIndex);
  if (shouldUploadSeoPointAliases) {
    await uploadSeoPointAliases(localFiles);
  } else {
    console.log('[publish-oss] SEO point alias upload skipped. Unset SEO_UPLOAD_POINT_ALIASES or set it to a value other than 0 to upload token/index.html aliases.');
  }

  for (const shellFile of shellFiles) await upload(shellFile, 0, remoteObjectInfoIndex);
};



run().then(() => {
  console.log(`All files have been uploaded to OSS in ${((Date.now() - publishStartedAt) / 1000).toFixed(1)}s.`);
}).catch((err) => {
  console.error('Error uploading files:', err);
  process.exitCode = 1;
});
