import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const shouldSkipIntel = args.includes('--skip-intel');

const getArgValue = (name, fallback = '') => {
  const withEq = args.find((arg) => arg.startsWith(`${name}=`));
  if (withEq) return withEq.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
};

const target = getArgValue('--target', 'org').toLowerCase();
const channel = getArgValue('--channel', process.env.DEPLOY_CHANNEL || 'beta').toLowerCase();
const outputDirArg = getArgValue('--output-dir', path.resolve(ROOT, '.pages-dist', `${target}-${channel}`));
const distDirArg = getArgValue('--dist-dir', process.env.DIST_DIR || path.resolve(ROOT, 'dist/r2'));

if (target !== 'org') {
  throw new Error(`Unsupported Pages target: ${target}. Only org is configured.`);
}

if (!['beta', 'prod'].includes(channel)) {
  throw new Error(`Unsupported Pages channel: ${channel}. Use beta or prod.`);
}

const pagesDefaults = {
  org: {
    beta: {
      project: 'oem-root-uatenv',
      branch: 'beta',
      customDomain: 'beta.opendfieldmap.org',
    },
    prod: {
      project: 'oem-root',
      branch: 'main',
      customDomain: 'opendfieldmap.org',
    },
  },
};

const defaults = pagesDefaults[target][channel];
const project = getArgValue('--project', defaults.project);
const branch = getArgValue('--branch', defaults.branch);
const customDomain = getArgValue('--custom-domain', defaults.customDomain);

const distDir = path.resolve(ROOT, distDirArg);
const outputDir = path.resolve(ROOT, outputDirArg);
const seoPointsDir = path.resolve(distDir, 'seo/points/r2');
const tokenPattern = /^[0-9a-zA-Z]{7}\.html$/;

const copyIfExists = async (relativePath) => {
  const source = path.resolve(distDir, relativePath);
  if (!(await fs.pathExists(source))) return false;
  await fs.copy(source, path.resolve(outputDir, relativePath));
  return true;
};

const rootFileNames = async () => {
  const entries = await fs.readdir(distDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((file) => {
      if (file === 'index.html') return true;
      if (file === 'manifest.json') return true;
      if (file === 'og_preview.jpg') return true;
      if (file === 'robots.txt') return true;
      if (/^sitemap.*\.xml$/i.test(file)) return true;
      if (/^favicon/i.test(file)) return true;
      if (/^apple-touch-icon/i.test(file)) return true;
      if (/^web-app-manifest-/i.test(file)) return true;
      return false;
    });
};

const copyRootFiles = async () => {
  const files = await rootFileNames();
  await Promise.all(files.map(copyIfExists));
  return files.length;
};

const copySeoPointAliases = async () => {
  if (!(await fs.pathExists(seoPointsDir))) {
    throw new Error(`${path.relative(ROOT, seoPointsDir)}/ does not exist. Run pnpm build:r2 first.`);
  }

  const files = (await fs.readdir(seoPointsDir))
    .filter((file) => tokenPattern.test(file))
    .sort();

  for (const file of files) {
    const token = path.basename(file, '.html');
    await fs.copy(
      path.resolve(seoPointsDir, file),
      path.resolve(outputDir, token, 'index.html'),
    );
  }

  return files.length;
};

const copyIntelApp = async () => {
  const source = path.resolve(distDir, 'intel');
  if (!(await fs.pathExists(path.resolve(source, 'index.html')))) {
    throw new Error(`${path.relative(ROOT, source)}/index.html does not exist. Run the Intel R2 build first.`);
  }
  await fs.copy(source, path.resolve(outputDir, 'intel'));
};

const writePagesConfigFiles = async () => {
  const redirects = shouldSkipIntel
    ? '/* /index.html 200\n'
    : '/intel /intel/index.html 200\n/intel/* /intel/index.html 200\n/* /index.html 200\n';
  const intelHeaders = shouldSkipIntel
    ? []
    : [
        '/intel/index.html',
        '  Cache-Control: no-cache, no-store, must-revalidate',
        '',
        '/intel/assets/*',
        '  Cache-Control: public, max-age=31536000, immutable',
        '',
      ];
  await fs.writeFile(
    path.resolve(outputDir, '_redirects'),
    redirects,
    'utf8',
  );

  await fs.writeFile(
    path.resolve(outputDir, '_headers'),
    [
      '/',
      '  Cache-Control: no-cache, no-store, must-revalidate',
      '',
      '/*.html',
      '  Cache-Control: no-cache, no-store, must-revalidate',
      '',
      ...intelHeaders,
      '/*/',
      '  Cache-Control: no-cache, no-store, must-revalidate',
      '',
      '/sitemap*.xml',
      '  Cache-Control: no-cache, no-store, must-revalidate',
      '',
      '/robots.txt',
      '  Cache-Control: no-cache, no-store, must-revalidate',
      '',
      '/manifest.json',
      '  Cache-Control: public, max-age=3600',
      '',
      '/og_preview.jpg',
      '  Cache-Control: public, max-age=3600',
      '',
      '/favicon*',
      '  Cache-Control: public, max-age=3600',
      '',
      '/apple-touch-icon*',
      '  Cache-Control: public, max-age=3600',
      '',
      '/web-app-manifest-*',
      '  Cache-Control: public, max-age=3600',
      '',
    ].join('\n'),
    'utf8',
  );
};

if (!(await fs.pathExists(path.resolve(distDir, 'index.html')))) {
  throw new Error(`${path.relative(ROOT, distDir)}/index.html does not exist. Run pnpm build:r2 first.`);
}

await fs.emptyDir(outputDir);

const rootCount = await copyRootFiles();
const pointCount = await copySeoPointAliases();
if (!shouldSkipIntel) await copyIntelApp();
await writePagesConfigFiles();

console.log('[package-pages] completed.');
console.log(`project: ${project}`);
console.log(`target: ${target}`);
console.log(`channel: ${channel}`);
console.log(`branch: ${branch}`);
console.log(`custom domain: ${customDomain}`);
console.log(`output: ${path.relative(ROOT, outputDir)}`);
console.log(`dist: ${path.relative(ROOT, distDir)}`);
console.log(`root files: ${rootCount}`);
console.log(`seo point pages: ${pointCount}`);
console.log(`intel: ${shouldSkipIntel ? 'skipped' : 'included'}`);
