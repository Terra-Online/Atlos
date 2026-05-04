import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import fs from "fs-extra";
import path from "path";
import crypto from "crypto";
import { getDeployChannel, resolveDeployPrefix } from "./release-channel.js";
import { buildClipIndex, normalizeObjectKey, toPrefixedObjectKey } from "./tile-index.js";

// Read R2 specific config: config/config.r2.json
// sample expected config file:
// {
//   "web": {
//     "build": {
//       "cdn": "https://xxx.org-cdn.com",
//       "r2": {
//         "endpoint": "https://<accountid>.r2.cloudflarestorage.com",
//         "bucket": "your-bucket",
//         "region": "auto",
//         "prefix": "/atlos-org",
//         "accessKeyId": "...",
//         "accessKeySecret": "..."
//       }
//     }
//   }
// }
const config = JSON.parse(fs.readFileSync("./config/config.r2.json", "utf-8"));
const { endpoint, bucket, region, prefix: basePrefix, accessKeyId, accessKeySecret } =
  config.web.build.r2;
const deployChannel = getDeployChannel();
const { prefix, source: prefixSource } = resolveDeployPrefix({
  basePrefix,
  channel: deployChannel,
  target: "r2",
  deployChannels: config?.web?.build?.deployChannels,
});

console.log(
  `[publish-R2] channel=${deployChannel} prefix=${prefix || "/"} source=${prefixSource}`
);

const client = new S3Client({
  region: region || "auto",
  endpoint,
  forcePathStyle: true, // R2 recommends path-style access
  credentials: {
    accessKeyId,
    secretAccessKey: accessKeySecret,
  },
});

function getAllFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);

  arrayOfFiles = arrayOfFiles || [];

  files.forEach(function (file) {
    if (fs.statSync(path.join(dirPath, file)).isDirectory()) {
      arrayOfFiles = getAllFiles(path.join(dirPath, file), arrayOfFiles);
    } else {
      const relativePath = path.relative("./dist", path.join(dirPath, file));
      arrayOfFiles.push(relativePath);
    }
  });

  return arrayOfFiles;
}

const listRemoteObjectKeys = async (prefixToList) => {
  const keys = [];
  let continuationToken;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefixToList,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      })
    );

    for (const item of response.Contents ?? []) {
      if (item.Key) {
        keys.push(item.Key);
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
};

const deleteRemoteObjectKeys = async (keys) => {
  if (!keys.length) return;

  const chunkSize = 1000;
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: chunk.map((Key) => ({ Key })),
          Quiet: true,
        },
      })
    );
  }
};

/**
 * Cache-Control strategy:
 * - assets/**  (hashed filenames)  → immutable, 1 year
 * - files/**   (archive HTML)      → public, 1 week (can be purged/revalidated)
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

// a simple MIME type mapping function
const getMimeType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".eot": "application/vnd.ms-fontobject",
    ".txt": "text/plain",
    ".xml": "application/xml",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".wasm": "application/wasm",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
  };
  return mimeMap[ext] || "application/octet-stream";
};

// Keep search docs on single PUT so the remote ETag stays comparable to local MD5.
const MULTIPART_THRESHOLD = 64 * 1024 * 1024;
const MAX_RETRIES = 3;

const normalizeEtag = (etag) =>
  String(etag ?? "").replace(/^"|"$/g, "").toLowerCase();

const calculateFileMd5 = (filePath) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash("md5");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });

const getRemoteObjectInfo = async (objectKey) => {
  try {
    const result = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: objectKey,
      })
    );
    return {
      etag: normalizeEtag(result.ETag),
      size: result.ContentLength ?? 0,
    };
  } catch (e) {
    const status = e?.$metadata?.httpStatusCode;
    if (status === 404 || e?.name === "NotFound" || e?.Code === "NoSuchKey") {
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
    `${relativePath} changed, uploading (remote size=${remote.size}, etag=${remote.etag || "-"}; local size=${fileSize}, etag=${localEtag})`
  );
  return false;
};

const upload = async (relativePath, retryCount = 0) => {
  // Normalize path separators to forward slashes
  const normalizedPath = relativePath.replace(/\\/g, '/');
  // Remove leading slash from prefix to avoid double slashes
  const cleanPrefix = prefix.replace(/^\/+/, '').replace(/\/+$/, '');
  const objectKey = cleanPrefix ? `${cleanPrefix}/${normalizedPath}` : normalizedPath;
  const localPath = `./dist/${relativePath}`;

  try {
    const stats = fs.statSync(localPath);
    const fileSize = stats.size;
    const contentType = getMimeType(localPath); // get MIME type

    if (await shouldSkipUpload(relativePath, objectKey, localPath, fileSize)) {
      return;
    }

    const cacheControl = getCacheControl(relativePath);

    if (fileSize > MULTIPART_THRESHOLD) {
      // Use AWS SDK v3's Upload for uploading (no longer forcing multipart)
      const upload = new Upload({
        client,
        params: {
          Bucket: bucket,
          Key: objectKey,
          Body: fs.createReadStream(localPath),
          ContentType: contentType,
          CacheControl: cacheControl,
        },
        leavePartsOnError: false,
      });

      await upload.done();
      console.log(
        `${relativePath} uploaded (multipart, ${(
          fileSize /
          1024 /
          1024
        ).toFixed(2)}MB, ${contentType})`
      );
    } else {
      // Small files direct PutObject
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: fs.createReadStream(localPath),
        ContentType: contentType,
        CacheControl: cacheControl,
      });
      await client.send(command);
      console.log(
        `${relativePath} uploaded (${(fileSize / 1024).toFixed(
          2
        )}KB, ${contentType})`
      );
    }
  } catch (e) {
    // Retry logic
    if (retryCount < MAX_RETRIES) {
      const waitTime = 2000 * Math.pow(2, retryCount); // 2s, 4s, 8s
      console.warn(
        `Retry ${retryCount + 1}/${MAX_RETRIES} after ${waitTime}ms: ${
          relativePath
        }`
      );
      await new Promise((r) => setTimeout(r, waitTime));
      return upload(relativePath, retryCount + 1);
    }
    console.error(
      `Upload failed after ${MAX_RETRIES} retries: ${relativePath}`,
      e?.name || e?.code || e?.message || e
    );
  }
};

const concurrency = 20; // limit concurrency
let index = 0;
let allFiles = [];

const reconcileClipObjects = async (expectedClipFiles) => {
  const clipPrefix = toPrefixedObjectKey(prefix, "clips/");
  const remoteClipKeys = await listRemoteObjectKeys(clipPrefix);

  const expectedSet = new Set(
    expectedClipFiles.map((relativePath) => toPrefixedObjectKey(prefix, relativePath))
  );

  const staleKeys = remoteClipKeys.filter((key) => !expectedSet.has(normalizeObjectKey(key)));

  if (!staleKeys.length) {
    console.log("[publish-R2] clips directory already consistent with index.");
    return;
  }

  await deleteRemoteObjectKeys(staleKeys);
  console.log(`[publish-R2] deleted ${staleKeys.length} stale clips objects.`);
};

const worker = async () => {
  while (index < allFiles.length) {
    const file = allFiles[index++];
    await upload(file);
  }
};

const run = async () => {
  const clipIndex = await buildClipIndex({ distDir: "./dist" });
  if (clipIndex.generated) {
    console.log(
      `[publish-R2] clip index generated: tiles=${clipIndex.tileFileCount}, coverageFiles=${clipIndex.coverageFileCount}`
    );
  } else {
    console.log(`[publish-R2] clip index skipped: ${clipIndex.reason}`);
  }

  allFiles = getAllFiles("./dist");
  const promises = [];

  for (let i = 0; i < concurrency; i++) {
    promises.push(worker());
  }

  await Promise.all(promises);

  if (clipIndex.generated) {
    await reconcileClipObjects(clipIndex.expectedClipFiles);
  }
};

run()
  .then(() => {
    console.log("All files have been uploaded to R2.");
  })
  .catch((err) => {
    console.error("Error uploading files to R2:", err);
});
