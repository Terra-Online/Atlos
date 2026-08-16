import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const shouldSkipSubset = args.includes('--skip-subset') || args.includes('--skip-subset-fonts');
const unknownArgs = args.filter((arg) => !['--skip-subset', '--skip-subset-fonts'].includes(arg));

if (unknownArgs.length > 0) {
  throw new Error(`Unknown build:all arguments: ${unknownArgs.join(', ')}`);
}

const baseEnv = {
  ...process.env,
  DEPLOY_CHANNEL: process.env.DEPLOY_CHANNEL || 'prod',
};

const runSync = (command, commandArgs, env = {}) => {
  console.log(`\n> ${[command, ...commandArgs].join(' ')}`);
  execFileSync(command, commandArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...baseEnv, ...env },
  });
};

const runAsync = (label, command, commandArgs, env = {}) =>
  new Promise((resolve) => {
    console.log(`\n[build:all:${label}] > ${[command, ...commandArgs].join(' ')}`);
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...baseEnv, ...env },
    });
    child.on('error', (error) => resolve({ label, ok: false, error }));
    child.on('exit', (code, signal) => resolve({
      label,
      ok: code === 0,
      code,
      signal,
    }));
  });

runSync('node', [
  './scripts/build-prepare.mjs',
  '--skip-seo',
  ...(shouldSkipSubset ? ['--skip-subset'] : []),
]);

runSync('node', ['./scripts/validate-intel-data.mjs']);

const targets = baseEnv.DEPLOY_CHANNEL === 'beta' ? [
  ['r2', './scripts/build-r2.mjs', 'dist/r2'],
] : [
  ['oss', './scripts/build-oss.mjs', 'dist/oss'],
  ['r2', './scripts/build-r2.mjs', 'dist/r2'],
];

const mainResults = await Promise.all(targets.map(([label, script, outDir]) =>
  runAsync(label, 'node', [script, '--skip-prepare'], {
    BUILD_TARGET: label,
    BUILD_OUT_DIR: outDir,
  })));

if (mainResults.some((result) => !result.ok)) {
  console.log('\n[build:all] main build failed; Intel build skipped.');
  process.exitCode = 1;
} else {
  const intelResults = await Promise.all(targets.map(([label]) =>
    runAsync(`intel-${label}`, 'pnpm', ['--filter', '@atlos/intel', label === 'r2' ? 'build:r2' : 'build:oss'], {
      BUILD_TARGET: label,
    })));
  mainResults.push(...intelResults);
}

const results = mainResults;

console.log('\n[build:all] summary');
for (const result of results) {
  console.log(`- ${result.label}: ${result.ok ? 'succeeded' : `failed (${result.signal || result.code || result.error?.message})`}`);
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
}
