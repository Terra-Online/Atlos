import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { pagesConfig } from './pages-config.mjs';
import { verifyArtifact, verifyOutput } from './release-artifact.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { target: { type: 'string' }, channel: { type: 'string' }, 'skip-intel': { type: 'boolean' },
    'dist-dir': { type: 'string' }, 'output-dir': { type: 'string' }, project: { type: 'string' },
    branch: { type: 'string' }, 'custom-domain': { type: 'string' }, help: { type: 'boolean' } },
});
if (values.help) {
  console.log('Usage: package-pages.mjs --target org --channel prod|beta [--dist-dir PATH] [--output-dir PATH] [--skip-intel]');
  process.exit(0);
}
const shouldSkipIntel = !!values['skip-intel'];
const target = (values.target || 'org').toLowerCase();
const channel = (values.channel || process.env.DEPLOY_CHANNEL || 'prod').toLowerCase();
const outputDirArg = values['output-dir'] || path.resolve(ROOT, '.pages-dist', `${target}-${channel}`);
const distDirArg = values['dist-dir'] || process.env.DIST_DIR || path.resolve(ROOT, 'dist/r2');

if (target !== 'org') {
  throw new Error(`Unsupported Pages target: ${target}. Only org is configured.`);
}

if (!['beta', 'prod'].includes(channel)) {
  throw new Error(`Unsupported Pages channel: ${channel}. Use beta or prod.`);
}

const defaults = pagesConfig[channel];
const project = values.project || defaults.project;
const branch = values.branch || defaults.branch;
const customDomain = values['custom-domain'] || defaults.customDomain;

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
    throw new Error(`${path.relative(ROOT, seoPointsDir)}/ does not exist. Run node scripts/tasks.mjs build --target org first.`);
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

const copyUserHubApp = async () => {
  const source = path.resolve(distDir, 'me');
  if (!(await fs.pathExists(path.resolve(source, 'index.html')))) {
    throw new Error(`${path.relative(ROOT, source)}/index.html does not exist. Run the user hub build first.`);
  }
  await fs.copy(source, path.resolve(outputDir, 'me'));
};

const writePagesConfigFiles = async () => {
  // Pages rejects wildcard rewrites to index.html as potential redirect loops.
  // Rewrite to the app directory, keeping its assets ahead of the SPA fallback.
  // Unmatched main-site paths use Pages' built-in root SPA fallback.
  const apps = shouldSkipIntel ? ['me'] : ['me', 'intel'];
  const redirects = apps.flatMap((app) => [
    `/${app} /${app}/ 302`,
    `/${app}/assets/* /${app}/assets/:splat 200`,
    `/${app}/* /${app}/ 200`,
  ]).join('\n') + '\n';
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
      '/me/index.html',
      '  Cache-Control: no-cache, no-store, must-revalidate',
      '',
      '/me/assets/*',
      '  Cache-Control: public, max-age=31536000, immutable',
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

// Validate the whole site before replacing a previous Pages package.
await verifyArtifact(distDir, { channel, skipIntel: shouldSkipIntel }, target);
await verifyOutput(ROOT, outputDir, 'pages');
const relativeOutput = path.relative(distDir, outputDir);
const relativeSource = path.relative(outputDir, distDir);
const isWithin = (relative) => relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
if (isWithin(relativeOutput) || isWithin(relativeSource)) {
  throw new Error('Pages output and source directories must not overlap.');
}

await fs.emptyDir(outputDir);

const rootCount = await copyRootFiles();
const pointCount = await copySeoPointAliases();
await copyUserHubApp();
if (!shouldSkipIntel) await copyIntelApp();
await writePagesConfigFiles();
await fs.writeJson(path.join(outputDir, '.atlos-pages.json'), { target, channel });

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
console.log('user hub: included');
