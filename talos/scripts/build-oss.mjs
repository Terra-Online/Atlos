import { execSync } from 'node:child_process';

const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};

const args = process.argv.slice(2);

const hasFlag = (name) => args.includes(name);
const isTruthyFlag = (value) =>
  typeof value === 'string' && value !== 'false' && value !== '0';

const argDeploy = hasFlag('--deploy');
const argSkipSubset = hasFlag('--skip-subset') || hasFlag('--skip-subset-fonts');
const envDeploy = process.env.npm_config_deploy;
const envSkipSubsetArg = process.env.npm_config_skip_subset;
const envSkipSubsetFontsArg = process.env.npm_config_skip_subset_fonts;
const envSkipSubset = process.env.SKIP_SUBSET_FONTS;

const shouldDeploy = argDeploy || isTruthyFlag(envDeploy);
const shouldSkipSubset =
  argSkipSubset ||
  isTruthyFlag(envSkipSubsetArg) ||
  isTruthyFlag(envSkipSubsetFontsArg) ||
  isTruthyFlag(envSkipSubset);

const passthroughArgs = args.filter(
  (arg) => !['--deploy', '--skip-subset', '--skip-subset-fonts'].includes(arg),
);

const prepareCmd = [
  'node ./scripts/build-prepare.mjs',
  shouldDeploy ? '--deploy' : '',
  shouldSkipSubset ? '--skip-subset' : '',
]
  .filter(Boolean)
  .join(' ');

const buildCmd = [
  'cross-env NODE_ENV=production vite build',
  ...passthroughArgs,
]
  .filter(Boolean)
  .join(' ');

run(prepareCmd);
run(buildCmd);