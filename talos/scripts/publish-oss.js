import OSS from 'ali-oss';
import fs from "fs-extra";
import path from "path";
import https from "https";
import http from "http";

const config = JSON.parse(fs.readFileSync('./config/config.json', 'utf-8'));
const { region, bucket, accessKeyId, accessKeySecret, prefix } = config.web.build.oss
const cdnPath = config.web.build.cdn + config.web.build.oss.prefix;

const client = new OSS({
  region,
  accessKeyId,
  accessKeySecret,
  authorizationV4: true,
  bucket,
  timeout: 120000, // 2 minutes
  agent: undefined, // 禁用连接池,避免callback twice
});

// 检查CDN资源是否存在
const checkCDNResourceExists = async (relativePath) => {
  return new Promise((resolve) => {
    const cdnUrl = `${cdnPath}/${relativePath}`;
    const url = new URL(cdnUrl);
    const client = url.protocol === 'https:' ? https : http;
    
    const req = client.request(url, { method: 'HEAD' }, (res) => {
      resolve({
        exists: res.statusCode === 200,
        size: parseInt(res.headers['content-length']) || 0
      });
    });
    
    req.on('error', () => {
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
      const relativePath = path.relative('./dist', path.join(dirPath, file));
      arrayOfFiles.push(relativePath);
    }
  });

  return arrayOfFiles;
}

const allFiles = getAllFiles('./dist');

// threshold for large file uploading
const MULTIPART_THRESHOLD = 1 * 1024 * 1024;
const MAX_RETRIES = 3;

const upload = async (relativePath, retryCount = 0) => {
  const objectKey = `${prefix}/${relativePath}`;
  const localPath = `./dist/${relativePath}`;
  
  const headers = {
    // 指定Object的存储类型。
    'x-oss-storage-class': 'Standard',
    // 指定Object的访问权限。
    'x-oss-object-acl': 'default',
    // 指定PutObject操作时是否覆盖同名目标Object。
    'x-oss-forbid-overwrite': 'false',
  };

  try {
    const stats = fs.statSync(localPath);
    const fileSize = stats.size;
    
    // 检查CDN是否已存在该资源
    const cdnCheck = await checkCDNResourceExists(relativePath);
    
    // 如果CDN已存在该资源且文件较大（大于1MB），则跳过上传
    if (cdnCheck.exists && fileSize > MULTIPART_THRESHOLD) {
      console.log(`跳过上传 ${relativePath} - CDN已存在该资源 (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);
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



run().then(() => {
  console.log('All files have been uploaded.');
}).catch((err) => {
  console.error('Error uploading files:', err);
});
