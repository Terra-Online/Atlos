import { execSync } from 'node:child_process';

const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};

const argDeploy = process.argv.includes('--deploy');
const envDeploy = process.env.npm_config_deploy;
const shouldDeploy = argDeploy || (typeof envDeploy === 'string' && envDeploy !== 'false' && envDeploy !== '0');
const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const envSkipSubset = process.env.SKIP_SUBSET_FONTS;
const shouldSkipSubset = isCi || (typeof envSkipSubset === 'string' && envSkipSubset !== 'false' && envSkipSubset !== '0');

if (shouldSkipSubset) {
  console.log('\nSkipping font subsetting in CI environment.');
} else {
  run('pnpm run subset:fonts');
}
run('pnpm run build:search-index');

if (shouldDeploy) {
  run('pnpm run worker:deploy');
} else {
  console.log('\nSkipping worker deploy. Pass --deploy to include worker update.');
}
