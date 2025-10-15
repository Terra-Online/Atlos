import OSS from 'ali-oss';
import fs from "fs-extra";
import path from "path"

const config = JSON.parse(fs.readFileSync('./config/config.json', 'utf-8'));
const { region, bucket, accessKeyId, accessKeySecret, prefix } = config.web.build.oss

const client = new OSS({
  region,
  accessKeyId,
  accessKeySecret,
  authorizationV4: true,
  bucket,
});

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

// for huge file upload(> 2MB)
const MULTIPART_THRESHOLD = 2 * 1024 * 1024; // 2MB

const upload = async (relativePath) => {
  const objectKey = `${prefix}/${relativePath}`;
  const localPath = `./dist/${relativePath}`;
  
  const headers = {
    // 指定Object的存储类型。
    'x-oss-storage-class': 'Standard',
    // 指定Object的访问权限。
    'x-oss-object-acl': 'default',
    // 指定PutObject操作时是否覆盖同名目标Object。此处设置为true，表示禁止覆盖同名Object。
    'x-oss-forbid-overwrite': 'false',
  };

  try {
    const stats = fs.statSync(localPath);
    const fileSize = stats.size;
    
    // huge file upload
    if (fileSize > MULTIPART_THRESHOLD) {
      await client.multipartUpload(objectKey, localPath, {
        headers,
        partSize: 1024 * 1024, // 1MB per part
        progress: (p, cpt) => {
          // progress callback
          if (cpt && cpt.doneParts) {
            const percent = Math.floor((cpt.doneParts.length / Math.ceil(fileSize / (1024 * 1024))) * 100);
            if (percent % 20 === 0) {
              console.log(`  ${relativePath}: ${percent}%`);
            }
          }
        }
      });
      console.log(`${relativePath} uploaded (multipart, ${(fileSize / 1024 / 1024).toFixed(2)}MB)`);
    } else {
      // small file upload
      await client.put(objectKey, localPath, { headers });
      console.log(`${relativePath} uploaded (${(fileSize / 1024).toFixed(2)}KB)`);
    }
  } catch (e) {
    console.error(`Upload failed: ${relativePath}`, e?.name || e?.code || e?.message || e);
  }
}

const concurrency = 20;
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
