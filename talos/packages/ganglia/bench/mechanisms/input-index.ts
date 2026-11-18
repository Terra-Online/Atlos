/**
 * Published by preparation after the exports succeed. A dataset can relocate
 * its inputs without changing the suite's scenes, window bounds or case IDs.
 * Each registered input root is separate from the shared routing exports.
 */
import { z } from 'zod';

const directory = z
  .string()
  .regex(/^(?![A-Za-z]:)(?:(?!\.{1,2}(?:\/|$))[A-Za-z0-9_.-]+\/)*(?!\.{1,2}$)[A-Za-z0-9_.-]+$/)
  .brand<'DatasetPath'>();
const entry = z.strictObject({ directory });
const indexSchema = z.strictObject({
  schema: z.literal(1),
  inputs: z.record(
    z.string(),
    z.strictObject({
      dynamic: entry.optional(),
      regions: z.record(z.string(), entry),
    }),
  ),
});

export type InputIndex = z.infer<typeof indexSchema>;

export function parseInputIndex(value: unknown): InputIndex {
  const index = indexSchema.parse(value);
  const roots = new Map<string, string>([
    ['routing', 'shared routing'],
    ['input-index.json', 'the input index'],
    ['input-index.json.tmp', 'the pending input index'],
  ]);
  function register(directory: z.infer<typeof entry>['directory'], label: string) {
    const path = directory.toLowerCase();
    for (const [other, owner] of roots)
      if (path === other || path.startsWith(other + '/') || other.startsWith(path + '/'))
        throw new Error(`Dataset directory ${directory} for ${label} overlaps ${owner}`);
    roots.set(path, label);
  }
  for (const [scene, { dynamic, regions }] of Object.entries(index.inputs)) {
    if (dynamic) register(dynamic.directory, `${scene} dynamic input`);
    for (const [id, { directory }] of Object.entries(regions))
      register(directory, `${scene} window ${id}`);
  }
  return index;
}
