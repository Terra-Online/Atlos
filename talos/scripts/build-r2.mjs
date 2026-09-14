import { execFileSync } from 'node:child_process';

const run = (command, args = [], env = {}) => {
  console.log(`\n> ${[command, ...args].join(' ')}`);
  execFileSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
};

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const isTruthyFlag = (value) =>
  typeof value === 'string' && value !== 'false' && value !== '0';

const shouldSkipPrepare = hasFlag('--skip-prepare');
const shouldDeploy = hasFlag('--deploy') || isTruthyFlag(process.env.npm_config_deploy);
const shouldSkipSubset =
  hasFlag('--skip-subset')
  || hasFlag('--skip-subset-fonts')
  || isTruthyFlag(process.env.npm_config_skip_subset)
  || isTruthyFlag(process.env.npm_config_skip_subset_fonts)
  || isTruthyFlag(process.env.SKIP_SUBSET_FONTS);
const outDir = process.env.BUILD_OUT_DIR || 'dist/r2';
const authBase = 'https://api.opendfieldmap.org';
const passthroughArgs = args.filter(
  (arg) => !['--deploy', '--skip-prepare', '--skip-subset', '--skip-subset-fonts'].includes(arg),
);

if (!shouldSkipPrepare) {
  run('node', [
    './scripts/build-prepare.mjs',
    '--skip-seo',
    ...(shouldDeploy ? ['--deploy'] : []),
    ...(shouldSkipSubset ? ['--skip-subset'] : []),
  ], { BUILD_TARGET: 'r2' });
}

run('pnpm', ['exec', 'vite', 'build', ...passthroughArgs], {
  NODE_ENV: 'production',
  BUILD_TARGET: 'r2',
  BUILD_OUT_DIR: outDir,
  VITE_AUTH_BASE: authBase,
});

run('node', ['./scripts/build-seo-pages.mjs'], {
  NODE_ENV: 'production',
  BUILD_TARGET: 'r2',
  SEO_PUBLIC_OUT_DIR: outDir,
  SEO_WRITE_ALL_POINT_FILES: '1',
  SEO_FORCE_POINT_FILES: '1',
  SEO_SKIP_IMAGES: '1',
});
