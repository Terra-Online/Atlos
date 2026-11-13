import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { benchmarkMarkdown, type MarkdownReport } from '#@/bench/markdown.ts';
import { sourceHash } from '#@/bench/source.ts';
import { nativeLibraryPath } from '#@/prototype/rust-kernel/native.ts';

// Both controls use the same isolated adapter so native hooks affect only
// the selected solver implementation.
const root = fileURLToPath(new URL('../../', import.meta.url));
const original = resolve(root, '../../.cache/noclip');
const adapter = resolve(root, '../../../.local/research/rust-transfers/adapter');
for (const name of ['extractor', 'formats']) {
  const source = resolve(original, 'packages', name),
    target = resolve(adapter, 'packages', name);
  await mkdir(target, { recursive: true });
  await cp(resolve(source, 'src'), resolve(target, 'src'), { recursive: true });
  await cp(resolve(source, 'package.json'), resolve(target, 'package.json'));
  const link = async (from: string, to: string) => {
    await mkdir(resolve(to, '..'), { recursive: true });
    await rm(to, { recursive: true, force: true });
    await symlink(from, to, 'dir');
  };
  for (const entry of await readdir(resolve(source, 'node_modules'), { withFileTypes: true })) {
    const names = entry.name.startsWith('@')
      ? (await readdir(resolve(source, 'node_modules', entry.name))).map(
          (n) => `${entry.name}/${n}`,
        )
      : [entry.name];
    for (const dependency of names) {
      const from =
        dependency === '@opendfieldmap/ganglia'
          ? root
          : dependency === '@endfield-noclip/formats'
            ? resolve(adapter, 'packages/formats')
            : await realpath(resolve(source, 'node_modules', dependency));
      await link(from, resolve(target, 'node_modules', dependency));
    }
  }
}
const args = process.argv.slice(2);
const native = !args.includes('--typescript');
const features = {
  GANGLIA_RUST_COLLISION: process.env.GANGLIA_RUST_COLLISION ?? '1',
  GANGLIA_RUST_LOCOMOTION: process.env.GANGLIA_RUST_LOCOMOTION ?? '1',
  GANGLIA_RUST_GROUND_TRACE: process.env.GANGLIA_RUST_GROUND_TRACE ?? '1',
  GANGLIA_RUST_GOALS: process.env.GANGLIA_RUST_GOALS ?? '1',
  GANGLIA_RUST_CANDIDATE: process.env.GANGLIA_RUST_CANDIDATE ?? '0',
  GANGLIA_RUST_ROUTE: process.env.GANGLIA_RUST_ROUTE ?? '0',
};
const sourceSha256 = await sourceHash(root, ['prototype/rust-kernel']);
if (native)
  execFileSync(process.execPath, [resolve(root, 'prototype/rust-kernel/build.ts')], {
    cwd: root,
    stdio: ['inherit', 'inherit', 'inherit'],
  });
const binaryHash = async () =>
  createHash('sha256')
    .update(await readFile(nativeLibraryPath))
    .digest('hex');
const binarySha256 = native ? await binaryHash() : undefined;
const workerOption = args.indexOf('--workers');
if (process.env.GANGLIA_PROFILE && workerOption >= 0 && args[workerOption + 1] !== '1')
  throw new Error('Profile only a single solver process with --workers 1');
const command = [
  `--max-old-space-size=${process.env.GANGLIA_BENCHMARK_HEAP_MB || '6144'}`,
  ...(native ? ['--import', resolve(root, 'prototype/rust-kernel/register.ts')] : []),
  ...(process.env.GANGLIA_PROFILE
    ? ['--import', resolve(root, 'prototype/rust-kernel/profile.ts')]
    : []),
  resolve(root, 'bench/cli.ts'),
  '--extractor',
  adapter,
  ...args.filter((arg) => arg !== '--typescript' && arg !== '--markdown'),
  ...(args.includes('--markdown') && !args.includes('--json') ? ['--json'] : []),
];
const run = spawnSync(process.execPath, command, {
  cwd: root,
  env: { ...process.env, ...features },
  stdio: ['inherit', 'pipe', 'inherit'],
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});
if (run.error) throw run.error;
if ((await sourceHash(root, ['prototype/rust-kernel'])) !== sourceSha256)
  throw new Error('Prototype source changed during measurement; discard this run');
if (native && (await binaryHash()) !== binarySha256)
  throw new Error('Native binary changed during measurement; discard this run');
if (run.status !== 0 && !run.stdout.trim()) process.exit(run.status ?? 1);
if (args.includes('--json') || args.includes('--markdown')) {
  const report: MarkdownReport = JSON.parse(run.stdout);
  report.prototype = {
    implementation: native ? 'rust-kernel' : 'typescript',
    sourceSha256,
    locomotionLabelLimit: native ? Number(process.env.GANGLIA_LOCOMOTION_LABELS ?? 256) : 256,
    nativeCollision: native && features.GANGLIA_RUST_COLLISION === '1',
    nativeLocomotion: native && features.GANGLIA_RUST_LOCOMOTION === '1',
    nativeGroundTrace: native && features.GANGLIA_RUST_GROUND_TRACE === '1',
    nativeGoals: native && features.GANGLIA_RUST_GOALS === '1',
    nativeCandidate: native && features.GANGLIA_RUST_CANDIDATE === '1',
    nativeRoute: native && features.GANGLIA_RUST_ROUTE === '1',
    ...(native ? { binarySha256 } : {}),
  };
  console.log(
    args.includes('--markdown') ? benchmarkMarkdown(report) : JSON.stringify(report, null, 2),
  );
} else process.stdout.write(run.stdout);
if (run.status !== 0) process.exitCode = run.status ?? 1;
