import crypto from 'node:crypto';
import { execFileSync, execSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);

const getArgValue = (name, fallback = '') => {
  const withEq = args.find((arg) => arg.startsWith(`${name}=`));
  if (withEq) return withEq.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
};

const hasFlag = (name) => args.includes(name);

const target = getArgValue('--target', 'cn').toLowerCase();
const channel = getArgValue('--channel', 'beta').toLowerCase();
const skipBuild = hasFlag('--skip-build');
const outputDirArg = getArgValue('--output-dir', path.resolve(ROOT, 'release-artifacts'));
const outputDir = path.resolve(ROOT, outputDirArg);

if (!['cn', 'org'].includes(target)) {
  throw new Error(`Unsupported --target: ${target}. Use cn or org.`);
}

if (!['beta', 'prod'].includes(channel)) {
  throw new Error(`Unsupported --channel: ${channel}. Use beta or prod.`);
}

const run = (command, commandArgs = [], options = {}) => {
  console.log(`\n> ${[command, ...commandArgs].join(' ')}`);
  execFileSync(command, commandArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    ...options,
  });
};

const getGitShortSha = () => {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'nogit';
  }
};

const formatTimestamp = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const pruneClips = async (distDir) => {
  const clipsDir = path.resolve(distDir, 'clips');
  const removed = {
    jinlongRemoved: false,
    removedScripts: [],
  };

  const jinlongDir = path.resolve(clipsDir, 'Jinlong');
  if (await fs.pathExists(jinlongDir)) {
    await fs.remove(jinlongDir);
    removed.jinlongRemoved = true;
  }

  if (!(await fs.pathExists(clipsDir))) {
    return removed;
  }

  const scriptExts = new Set(['.py', '.sh', '.js', '.mjs', '.ts', '.bash', '.zsh']);

  const walk = async (dir) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!scriptExts.has(ext)) continue;

      await fs.remove(fullPath);
      removed.removedScripts.push(path.relative(distDir, fullPath).replace(/\\/g, '/'));
    }
  };

  await walk(clipsDir);
  return removed;
};

const sha256File = async (filePath) => {
  const hasher = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hasher.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hasher.digest('hex')));
  });
};

const build = () => {
  if (skipBuild) {
    console.log('Skipping build because --skip-build was provided.');
    return;
  }

  const env = {
    ...process.env,
    DEPLOY_CHANNEL: channel,
  };

  if (target === 'org') {
    run('pnpm', ['build:r2'], { env });
    return;
  }

  run('pnpm', ['build'], { env });
};

const packageDist = async () => {
  const distDir = path.resolve(ROOT, 'dist');
  if (!(await fs.pathExists(distDir))) {
    throw new Error('dist directory does not exist. Build may have failed.');
  }

  const workDir = path.resolve(ROOT, '.release-work', `${target}-${channel}-${Date.now()}`);
  const workDist = path.resolve(workDir, 'dist');

  await fs.ensureDir(workDir);
  await fs.copy(distDir, workDist);

  const pruneReport = await pruneClips(workDist);

  await fs.ensureDir(outputDir);
  const timestamp = formatTimestamp();
  const sha = getGitShortSha();
  const artifactBase = `dist-${target}-${channel}-${timestamp}-${sha}`;
  const zipPath = path.resolve(outputDir, `${artifactBase}.zip`);

  execFileSync('zip', ['-qr', zipPath, 'dist'], {
    cwd: workDir,
    stdio: 'inherit',
  });

  const digest = await sha256File(zipPath);
  const checksumPath = `${zipPath}.sha256`;
  await fs.writeFile(checksumPath, `${digest}  ${path.basename(zipPath)}\n`, 'utf8');

  const metadata = {
    target,
    channel,
    gitSha: sha,
    timestamp,
    artifact: path.basename(zipPath),
    checksum: digest,
    prune: {
      jinlongRemoved: pruneReport.jinlongRemoved,
      removedScriptCount: pruneReport.removedScripts.length,
      removedScripts: pruneReport.removedScripts,
    },
  };

  const metadataPath = path.resolve(outputDir, `${artifactBase}.json`);
  await fs.writeJson(metadataPath, metadata, { spaces: 2 });

  await fs.remove(workDir);

  console.log('\nPackaging completed.');
  console.log(`artifact: ${zipPath}`);
  console.log(`checksum: ${checksumPath}`);
  console.log(`metadata: ${metadataPath}`);
};

build();
await packageDist();
