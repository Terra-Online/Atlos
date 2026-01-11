import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import fs from "fs-extra";
import path from "path";
import https from "https";
import http from "http";

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
const { endpoint, bucket, region, prefix, accessKeyId, accessKeySecret } =
  config.web.build.r2;
const cdnPath = config.web.build.cdn + config.web.build.r2.prefix;

const client = new S3Client({
  region: region || "auto",
  endpoint,
  forcePathStyle: true, // R2 recommends path-style access
  credentials: {
    accessKeyId,
    secretAccessKey: accessKeySecret,
  },
});

// Check if CDN resource exists (logic consistent with publish-oss.js)
const checkCDNResourceExists = async (relativePath) => {
  return new Promise((resolve) => {
    const cdnUrl = `${cdnPath}/${relativePath}`;
    const url = new URL(cdnUrl);
    const client = url.protocol === "https:" ? https : http;

    const req = client.request(url, { method: "HEAD" }, (res) => {
      resolve({
        exists: res.statusCode === 200,
        size: parseInt(res.headers["content-length"]) || 0,
      });
    });

    req.on("error", () => {
      resolve({ exists: false, size: 0 });
    });

    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ exists: false, size: 0 });
    });

    req.end();
  });
};

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

const allFiles = getAllFiles("./dist");

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

// Minimum threshold for R2 is 5MB
const MULTIPART_THRESHOLD = 5 * 1024 * 1024; // 5MB
const MAX_RETRIES = 3;

const upload = async (relativePath, retryCount = 0) => {
  const objectKey = `${prefix}/${relativePath}`;
  const localPath = `./dist/${relativePath}`;

  try {
    const stats = fs.statSync(localPath);
    const fileSize = stats.size;
    const contentType = getMimeType(localPath); // get MIME type

    // check if CDN already has the resource
    const cdnCheck = await checkCDNResourceExists(relativePath);

    // If the resource already exists on the CDN and the file is large (greater than 5MB), skip uploading
    if (cdnCheck.exists && fileSize > MULTIPART_THRESHOLD) {
      console.log(
        `Skipping upload of ${relativePath} - resource already exists (${(
          fileSize /
          1024 /
          1024
        ).toFixed(2)}MB)`
      );
      return;
    }

    if (fileSize > MULTIPART_THRESHOLD) {
      // Use AWS SDK v3's Upload for uploading (no longer forcing multipart)
      const upload = new Upload({
        client,
        params: {
          Bucket: bucket,
          Key: objectKey,
          Body: fs.createReadStream(localPath),
          ContentType: contentType, // specify Content-Type
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
        ContentType: contentType, // specify Content-Type
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

const worker = async () => {
  while (index < allFiles.length) {
    const file = allFiles[index++];
    await upload(file);
  }
};

const run = async () => {
  const promises = [];

  for (let i = 0; i < concurrency; i++) {
    promises.push(worker());
  }

  await Promise.all(promises);
};

run()
  .then(() => {
    console.log("All files have been uploaded to R2.");
  })
  .catch((err) => {
    console.error("Error uploading files to R2:", err);
});