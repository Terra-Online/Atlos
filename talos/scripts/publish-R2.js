import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import fs from "fs-extra";
import path from "path";
import https from "https";
import http from "http";

// 读取 R2 专用配置：config/config.r2.json
// 结构示例：
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
  forcePathStyle: true, // R2 推荐 path-style 访问
  credentials: {
    accessKeyId,
    secretAccessKey: accessKeySecret,
  },
});

// 检查 CDN 资源是否存在（逻辑与 publish-oss.js 一致）
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

// 与 OSS 脚本保持一致的阈值和重试逻辑
const MULTIPART_THRESHOLD = 1 * 1024 * 1024; // 1MB
const MAX_RETRIES = 3;

const upload = async (relativePath, retryCount = 0) => {
  const objectKey = `${prefix}/${relativePath}`;
  const localPath = `./dist/${relativePath}`;

  try {
    const stats = fs.statSync(localPath);
    const fileSize = stats.size;

    // 检查 CDN 是否已存在该资源
    const cdnCheck = await checkCDNResourceExists(relativePath);

    // 如果 CDN 已存在该资源且文件较大（大于 1MB），则跳过上传
    if (cdnCheck.exists && fileSize > MULTIPART_THRESHOLD) {
      console.log(
        `跳过上传 ${relativePath} - CDN已存在该资源 (${(
          fileSize /
          1024 /
          1024
        ).toFixed(2)}MB)`
      );
      return;
    }

    if (fileSize > MULTIPART_THRESHOLD) {
      // 使用 AWS SDK v3 的 Upload 进行分片上传
      const upload = new Upload({
        client,
        params: {
          Bucket: bucket,
          Key: objectKey,
          Body: fs.createReadStream(localPath),
        },
        partSize: 2 * 1024 * 1024, // 2MB per part
        queueSize: 3, // 并发分片数
        leavePartsOnError: false,
      });

      await upload.done();
      console.log(
        `${relativePath} uploaded (multipart, ${(
          fileSize /
          1024 /
          1024
        ).toFixed(2)}MB)`
      );
    } else {
      // 小文件直接 PutObject
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: fs.createReadStream(localPath),
      });
      await client.send(command);
      console.log(
        `${relativePath} uploaded (${(fileSize / 1024).toFixed(2)}KB)`
      );
    }
  } catch (e) {
    // 重试逻辑
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

const concurrency = 5; // limit concurrency
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
