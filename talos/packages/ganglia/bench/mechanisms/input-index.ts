import { z } from 'zod';

const directory = z
  .string()
  .regex(/^(?![A-Za-z]:)(?:(?!\.{1,2}(?:\/|$))[A-Za-z0-9_.-]+\/)*(?!\.{1,2}$)[A-Za-z0-9_.-]+$/);
const indexSchema = z.strictObject({
  inputs: z.record(z.string(), z.strictObject({ directory })),
});

export type InputIndex = z.infer<typeof indexSchema>;

export function parseInputIndex(value: unknown): InputIndex {
  const index = indexSchema.parse(value);
  const roots = ['routing', 'input-index.json', 'input-index.json.tmp'];
  for (const { directory } of Object.values(index.inputs)) {
    const name = directory.toLowerCase();
    if (
      roots.some(
        (path) => path === name || name.startsWith(path + '/') || path.startsWith(name + '/'),
      )
    )
      throw new Error(`Overlapping physical pack directory: ${directory}`);
    roots.push(name);
  }
  return index;
}
