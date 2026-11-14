import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** Bind persisted physical builds to their generator without depending on route/search code.
 * Consumers combine this opaque identity with their own importer and input bindings. */
export async function groundBuildIdentity(): Promise<string> {
  const hash = createHash('sha256');
  for (const source of [
    './build-identity.ts',
    './build.ts',
    './support-field.ts',
    './clip-surface.ts',
  ]) {
    hash.update(await readFile(new URL(source, import.meta.url))).update('\0');
  }
  const manifest: { dependencies: Record<string, string> } = JSON.parse(
    await readFile(new URL(import.meta.resolve('#@/package.json')), 'utf8'),
  );
  return hash.update(JSON.stringify(manifest.dependencies)).digest('hex');
}
