import { execSync } from 'node:child_process';

const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};

const argDeploy = process.argv.includes('--deploy');
const argSkipSubset = process.argv.includes('--skip-subset') || process.argv.includes('--skip-subset-fonts');
const envDeploy = process.env.npm_config_deploy;
const shouldDeploy =
  argDeploy ||
  (typeof envDeploy === 'string' && envDeploy !== 'false' && envDeploy !== '0');

const prepareCmd = [
  'cross-env NODE_ENV=production BUILD_TARGET=r2 node ./scripts/build-prepare.mjs',
  shouldDeploy ? '--deploy' : '',
  argSkipSubset ? '--skip-subset' : '',
]
  .filter(Boolean)
  .join(' ');

run(prepareCmd);
run('cross-env NODE_ENV=production BUILD_TARGET=r2 vite build');
