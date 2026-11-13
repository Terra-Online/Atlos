import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const nativeLibraryPath = resolve(
  root,
  process.env.GANGLIA_NATIVE_LIBRARY ?? '../../../.local/cache/rust-transfers/transfer.node',
);

// Selecting a separate artifact lets experiments coexist with an already loaded
// control library.
export const loadNativeLibrary = (): unknown => createRequire(import.meta.url)(nativeLibraryPath);
