import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, realpathSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const algorithm = process.argv[2] ?? 'ganglia-v1';
if (algorithm !== 'ganglia-v1' && algorithm !== 'ganglia-v2')
  throw new Error(`Unknown Rust algorithm: ${algorithm}`);
const libraryStem = algorithm.replaceAll('-', '_');
const checkout = createHash('sha256').update(root).digest('hex').slice(0, 16);
const target =
  process.env.CARGO_TARGET_DIR ??
  resolve(root, '../../../.local/cache/rust-targets', checkout, algorithm);
execFileSync(
  'cargo',
  [
    'build',
    '--release',
    '--locked',
    '--features',
    'napi',
    '--manifest-path',
    `crates/${algorithm}/Cargo.toml`,
  ],
  { cwd: root, stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: target } },
);
const library =
  process.platform === 'darwin'
    ? `lib${libraryStem}.dylib`
    : process.platform === 'win32'
      ? `${libraryStem}.dll`
      : `lib${libraryStem}.so`;
const destination =
  process.env[`${algorithm.replaceAll('-', '_').toUpperCase()}_RUST_LIBRARY`] ??
  resolve(root, `../../../.local/cache/${algorithm}/${algorithm}.node`);
mkdirSync(dirname(destination), { recursive: true });
// Keep the inode of an artifact already loaded by another Node process intact.
const staged = `${destination}.${process.pid}.tmp`;
copyFileSync(resolve(target, 'release', library), staged);
renameSync(staged, destination);
console.log(destination);
