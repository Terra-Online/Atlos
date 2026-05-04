import OSS from 'ali-oss';
import fs from "fs-extra";
import path from "path";
import crypto from "crypto";
import { getDeployChannel, resolveDeployPrefix } from "./release-channel.js";
import { buildClipIndex, normalizeObjectKey, toPrefixedObjectKey } from './tile-index.js';

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
    if (fs.statSync(path.join(dirPath, file)).isDirectory()) {
      arrayOfFiles = getAllFiles(path.join(dirPath, file), arrayOfFiles);
    } else {
      const relativePath = path.relative('./dist', path.join(dirPath, file));
      arrayOfFiles.push(relativePath);
    }
  });

  return arrayOfFiles;
}

const listRemoteObjectKeys = async (prefixToList) => {
  const keys = [];
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
        keys.push(item.name);
      }
    }

    continuationToken = response.nextContinuationToken;
  } while (continuationToken);

  return keys;
};

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

const shouldSkipUpload = async (relativePath, objectKey, localPath, fileSize) => {
  const [localEtag, remote] = await Promise.all([
    calculateFileMd5(localPath),
    getRemoteObjectInfo(objectKey),
  ]);

  if (!remote) return false;

  if (remote.size === fileSize && remote.etag === localEtag) {
    console.log(`${relativePath} skipped (same ETag ${localEtag})`);
    return true;
  }

  console.log(
    `${relativePath} changed, uploading (remote size=${remote.size}, etag=${remote.etag || '-'}; local size=${fileSize}, etag=${localEtag})`
  );
  return false;
};

const upload = async (relativePath, retryCount = 0) => {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  const cleanPrefix = prefix.replace(/^\/+/, '').replace(/\/+$/, '');
  const objectKey = cleanPrefix ? `${cleanPrefix}/${normalizedPath}` : normalizedPath;
  const localPath = `./dist/${relativePath}`;
  
  const headers = {
    'x-oss-storage-class': 'Standard',
    'x-oss-object-acl': 'default',
    'x-oss-forbid-overwrite': 'false',
    'Cache-Control': getCacheControl(relativePath),
  };

  try {
    const stats = fs.statSync(localPath);
    const fileSize = stats.size;

    if (await shouldSkipUpload(relativePath, objectKey, localPath, fileSize)) {
      return;
    }
    
    // huge file upload
    if (fileSize > MULTIPART_THRESHOLD) {
      await client.multipartUpload(objectKey, localPath, {
        headers,
        partSize: 2 * 1024 * 1024, // 2MB per part (reduce part quantity)
        parallel: 3, // 3 parts upload concurrency
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
      return upload(relativePath, retryCount + 1);
    }
    console.error(`Upload failed after ${MAX_RETRIES} retries: ${relativePath}`, e?.name || e?.code || e?.message || e);
  }
}

const concurrency = 5; // limit concurrency
let index = 0;
let allFiles = [];

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

const worker = async () => {
  while (index < allFiles.length) {
    const file = allFiles[index++];
    await upload(file);
  }
};

const run = async () => {
  const clipIndex = await buildClipIndex({ distDir: './dist' });
  if (clipIndex.generated) {
    console.log(
      `[publish-oss] clip index generated: tiles=${clipIndex.tileFileCount}, coverageFiles=${clipIndex.coverageFileCount}`
    );
  } else {
    console.log(`[publish-oss] clip index skipped: ${clipIndex.reason}`);
  }

  allFiles = getAllFiles('./dist');
  const promises = [];

  for (let i = 0; i < concurrency; i++) {
    promises.push(worker());
  }

  await Promise.all(promises);

  if (clipIndex.generated) {
    await reconcileClipObjects(clipIndex.expectedClipFiles);
  }
};



run().then(() => {
  console.log('All files have been uploaded.');
}).catch((err) => {
  console.error('Error uploading files:', err);
});
