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

const upload = async (path) => {
  const headers = {
    // 指定Object的存储类型。
    'x-oss-storage-class': 'Standard',
    // 指定Object的访问权限。
    'x-oss-object-acl': 'default',
    // 指定PutObject操作时是否覆盖同名目标Object。此处设置为true，表示禁止覆盖同名Object。
    'x-oss-forbid-overwrite': 'false',
  };

  try {
    await client.put(`${prefix}/${path}`, `./dist/${path}`
      // 自定义headers
      , { headers }
    );
    console.log(`${path} uploaded`);
  } catch (e) {
    console.log(e);
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
