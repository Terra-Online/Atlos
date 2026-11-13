import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Bind measurements to the code actually loaded, and reject edits during a run. */
export async function sourceHash(root: string, directories: readonly string[]) {
  const hash = createHash('sha256');
  for (const directory of directories)
    for (const name of (await readdir(resolve(root, directory), { recursive: true })).sort()) {
      if (name.endsWith('.ts') || name.endsWith('.rs') || /^Cargo\.(toml|lock)$/.test(name))
        hash
          .update(`${directory}/${name}\0`)
          .update(await readFile(resolve(root, directory, name)));
    }
  return hash.digest('hex');
}
