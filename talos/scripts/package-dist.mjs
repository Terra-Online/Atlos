import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { verifyArtifact } from './release-artifact.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { target: { type: 'string' }, channel: { type: 'string' }, 'skip-build': { type: 'boolean' },
    'dist-dir': { type: 'string' }, 'output-dir': { type: 'string' }, 'skip-intel': { type: 'boolean' }, help: { type: 'boolean' } },
});
if (values.help) {
  console.log('Usage: package-dist.mjs --target cn|org --channel prod|beta [--skip-build] [--dist-dir PATH] [--output-dir PATH]');
  process.exit(0);
}
const target = (values.target || 'org').toLowerCase();
const channel = (values.channel || process.env.DEPLOY_CHANNEL || 'prod').toLowerCase();
const skipBuild = !!values['skip-build'];
const outputDirArg = values['output-dir'] || path.resolve(ROOT, 'release-artifacts');
const outputDir = path.resolve(ROOT, outputDirArg);
const defaultDistDir = target === 'org' ? 'dist/r2' : 'dist/oss';
const distDirArg = values['dist-dir'] || process.env.DIST_DIR || defaultDistDir;

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

const formatTimestamp = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const excludedClipDirNames = new Set(['jinlong']);

const isExcludedClipDir = (name) => excludedClipDirNames.has(name.toLowerCase());

const pruneClips = async (distDir) => {
  const clipsDir = path.resolve(distDir, 'clips');
  const removed = {
    removedClipDirs: [],
    removedLooseFiles: [],
    removedScripts: [],
  };

  if (!(await fs.pathExists(clipsDir))) {
    return removed;
  }

  const clipEntries = await fs.readdir(clipsDir, { withFileTypes: true });
  for (const entry of clipEntries) {
    const fullPath = path.resolve(clipsDir, entry.name);
    if (entry.isDirectory()) {
      if (!isExcludedClipDir(entry.name)) continue;

      await fs.remove(fullPath);
      removed.removedClipDirs.push(path.relative(distDir, fullPath).replace(/\\/g, '/'));
      continue;
    }

    await fs.remove(fullPath);
    removed.removedLooseFiles.push(path.relative(distDir, fullPath).replace(/\\/g, '/'));
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

  run(process.execPath, ['scripts/tasks.mjs', 'build', '--target', target,
    '--channel', channel, '--dist-dir', path.resolve(ROOT, distDirArg), ...(values['skip-intel'] ? ['--skip-intel'] : [])]);
};

const packageDist = async () => {
  const distDir = path.resolve(ROOT, distDirArg);
  const info = await verifyArtifact(distDir, { channel, skipIntel: !!values['skip-intel'] }, target);

  const workDir = path.resolve(ROOT, '.release-work', `${target}-${channel}-${Date.now()}`);
  const workDist = path.resolve(workDir, 'dist');

  await fs.ensureDir(workDir);
  await fs.copy(distDir, workDist);

  const pruneReport = await pruneClips(workDist);

  await fs.ensureDir(outputDir);
  const timestamp = formatTimestamp();
  const sha = info.source.slice(0, 12);
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
    sourceDirty: info.sourceDirty,
    timestamp,
    artifact: path.basename(zipPath),
    checksum: digest,
    prune: {
      removedClipDirCount: pruneReport.removedClipDirs.length,
      removedClipDirs: pruneReport.removedClipDirs,
      removedLooseFileCount: pruneReport.removedLooseFiles.length,
      removedLooseFiles: pruneReport.removedLooseFiles,
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
