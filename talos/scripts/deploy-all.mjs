import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const shouldSkipSubset = args.includes('--skip-subset') || args.includes('--skip-subset-fonts');
const shouldSkipOg = args.includes('--skip-og') || args.includes('--skip-seo-og');
const shouldSkipIntel = args.includes('--skip-intel');
const knownArgs = [
  '--skip-subset',
  '--skip-subset-fonts',
  '--skip-og',
  '--skip-seo-og',
  '--skip-intel',
];
const unknownArgs = args.filter((arg) => !knownArgs.includes(arg));

if (unknownArgs.length > 0) {
  throw new Error(`Unknown deploy:all arguments: ${unknownArgs.join(', ')}`);
}

const baseEnv = {
  ...process.env,
  DEPLOY_CHANNEL: 'prod',
};

const runSync = (command, commandArgs, env = {}) => {
  console.log(`\n> ${[command, ...commandArgs].join(' ')}`);
  execFileSync(command, commandArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...baseEnv, ...env },
  });
};

const runStep = (label, command, commandArgs, env = {}) =>
  new Promise((resolve, reject) => {
    console.log(`\n[deploy:all:${label}] > ${[command, ...commandArgs].join(' ')}`);
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...baseEnv, ...env },
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} exited with ${signal || code}`));
    });
  });

const runPipeline = async (label, steps) => {
  try {
    for (const step of steps) {
      await runStep(`${label}:${step.name}`, step.command, step.args, step.env);
    }
    return { label, ok: true };
  } catch (error) {
    console.error(`[deploy:all:${label}] failed:`, error.message);
    return { label, ok: false, error };
  }
};

runSync('node', [
  './scripts/build-prepare.mjs',
  '--skip-seo',
  ...(shouldSkipSubset ? ['--skip-subset'] : []),
]);

if (!shouldSkipIntel) {
  runSync('node', ['./scripts/validate-intel-data.mjs']);
  if (!shouldSkipSubset) {
    runSync('pnpm', ['--filter', '@atlos/intel', 'subset:fonts']);
  }
}

if (!shouldSkipOg) runSync('pnpm', ['run', 'build:seo:og']);

const ossDistDir = path.resolve(ROOT, 'dist/oss');
const r2DistDir = path.resolve(ROOT, 'dist/r2');
const intelBuildStep = (target) => ({
  name: 'build-intel',
  command: 'pnpm',
  args: ['--filter', '@atlos/intel', 'exec', 'vite', 'build'],
  env: { BUILD_TARGET: target },
});

const results = await Promise.all([
  runPipeline('cn', [
    {
      name: 'build',
      command: 'node',
      args: ['./scripts/build-oss.mjs', '--skip-prepare'],
      env: { BUILD_TARGET: 'oss', BUILD_OUT_DIR: 'dist/oss' },
    },
    ...(!shouldSkipIntel ? [intelBuildStep('oss')] : []),
    {
      name: 'publish',
      command: 'bash',
      args: ['./scripts/deploy-cn-server.sh', '--skip-build', '--dist-dir', 'dist/oss'],
      env: { DIST_DIR: ossDistDir },
    },
  ]),
  runPipeline('org', [
    {
      name: 'build',
      command: 'node',
      args: ['./scripts/build-r2.mjs', '--skip-prepare'],
      env: { BUILD_TARGET: 'r2', BUILD_OUT_DIR: 'dist/r2' },
    },
    ...(!shouldSkipIntel ? [intelBuildStep('r2')] : []),
    {
      name: 'publish-r2',
      command: 'pnpm',
      args: ['publish:web:r2'],
      env: { DIST_DIR: r2DistDir },
    },
    {
      name: 'package-pages',
      command: 'pnpm',
      args: [
        'package:pages:org:prod',
        ...(shouldSkipIntel ? ['--', '--skip-intel'] : []),
      ],
      env: { DIST_DIR: r2DistDir },
    },
    {
      name: 'publish-pages',
      command: 'pnpm',
      args: ['publish:pages:org:prod'],
      env: { DIST_DIR: r2DistDir },
    },
  ]),
]);

let relinkResult = {
  label: 'relink-worker',
  ok: false,
  skipped: true,
  error: new Error('skipped because a site pipeline failed'),
};
if (results.every((result) => result.ok)) {
  relinkResult = await runPipeline('relink-worker', [
    {
      name: 'deploy',
      command: 'pnpm',
      args: ['worker:relink:deploy'],
    },
  ]);
}

const allResults = [...results, relinkResult];

console.log('\n[deploy:all] summary');
for (const result of allResults) {
  const status = result.ok
    ? 'succeeded'
    : result.skipped
      ? result.error.message
      : `failed (${result.error.message})`;
  console.log(`- ${result.label}: ${status}`);
}

if (allResults.some((result) => !result.ok && !result.skipped)) {
  process.exitCode = 1;
}
