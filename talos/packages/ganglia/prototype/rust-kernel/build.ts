import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, realpathSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { nativeLibraryPath } from '#@/prototype/rust-kernel/native.ts';

const root = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
// Linked .local directories share artifacts, while Cargo incremental state belongs
// to one checkout. Stable checkout identity avoids cross-worktree reuse by mtime.
const checkout = createHash('sha256').update(root).digest('hex').slice(0, 16);
const target = `${root}/../../../.local/cache/rust-targets/${checkout}`;
execFileSync(
  'cargo',
  ['build', '--release', '--locked', '--manifest-path', 'prototype/rust-kernel/Cargo.toml'],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CARGO_TARGET_DIR: target },
  },
);
const library =
  process.platform === 'darwin'
    ? 'libganglia_transfer_prototype.dylib'
    : process.platform === 'win32'
      ? 'ganglia_transfer_prototype.dll'
      : 'libganglia_transfer_prototype.so';
// Renaming preserves any library inode already mapped by another Node isolate.
mkdirSync(dirname(nativeLibraryPath), { recursive: true });
const staged = `${nativeLibraryPath}.${process.pid}.tmp`;
copyFileSync(`${target}/release/${library}`, staged);
renameSync(staged, nativeLibraryPath);
