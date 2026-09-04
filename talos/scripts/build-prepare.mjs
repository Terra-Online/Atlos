import { execSync } from 'node:child_process';

const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};

const isTruthyFlag = (value) =>
  typeof value === 'string' && value !== 'false' && value !== '0';

const argDeploy = process.argv.includes('--deploy');
const envDeploy = process.env.npm_config_deploy;
const shouldDeploy = argDeploy || isTruthyFlag(envDeploy);
const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const argSkipSubset = process.argv.includes('--skip-subset') || process.argv.includes('--skip-subset-fonts');
const argSkipSeo = process.argv.includes('--skip-seo');
const envSkipSubsetArg = process.env.npm_config_skip_subset;
const envSkipSubsetFontsArg = process.env.npm_config_skip_subset_fonts;
const envSkipSubset = process.env.SKIP_SUBSET_FONTS;
const shouldSkipSubset = isCi
  || argSkipSubset
  || isTruthyFlag(envSkipSubsetArg)
  || isTruthyFlag(envSkipSubsetFontsArg)
  || isTruthyFlag(envSkipSubset);

if (shouldSkipSubset) {
  console.log('\nSkipping font subsetting.');
} else {
  run('pnpm run subset:fonts');
}
run('pnpm run validate:marker-overrides');
run('pnpm run build:marker-stats');
run('pnpm run build:marker-diff');
run('pnpm run build:search-index');
run('pnpm run build:relink-preview');
if (argSkipSeo) {
  console.log('\nSkipping shared SEO page generation.');
} else {
  run('pnpm run build:seo:pages');
}

if (shouldDeploy) {
  run('pnpm run worker:deploy');
} else {
  console.log('\nSkipping worker deploy. Pass --deploy to include worker update.');
}
