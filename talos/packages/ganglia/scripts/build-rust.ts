import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, realpathSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const checkout = createHash('sha256').update(root).digest('hex').slice(0, 16);
const target =
  process.env.CARGO_TARGET_DIR ??
  resolve(root, '../../../.local/cache/rust-targets', checkout, 'ganglia-v1');
execFileSync(
  'cargo',
  [
    'build',
    '--release',
    '--locked',
    '--features',
    'napi',
    '--manifest-path',
    'crates/ganglia-v1/Cargo.toml',
  ],
  { cwd: root, stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: target } },
);
const library =
  process.platform === 'darwin'
    ? 'libganglia_v1.dylib'
    : process.platform === 'win32'
      ? 'ganglia_v1.dll'
      : 'libganglia_v1.so';
const destination =
  process.env.GANGLIA_V1_RUST_LIBRARY ??
  resolve(root, '../../../.local/cache/ganglia-v1/ganglia-v1.node');
mkdirSync(dirname(destination), { recursive: true });
// Keep the inode of an artifact already loaded by another Node process intact.
const staged = `${destination}.${process.pid}.tmp`;
copyFileSync(resolve(target, 'release', library), staged);
renameSync(staged, destination);
console.log(destination);
