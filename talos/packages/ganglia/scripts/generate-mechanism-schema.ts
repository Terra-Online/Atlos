/** Export the runtime contract for JSON editors. */
import { writeFile } from 'node:fs/promises';

import { z } from 'zod';

import { suiteSchema } from '#@/bench/mechanisms/suite-schema.ts';

const output = new URL('../bench/scenes/mechanisms/suite.schema.json', import.meta.url);
const schema = z.toJSONSchema(suiteSchema, {
  reused: 'ref',
  override: ({ jsonSchema }) => {
    // prefixItems validates positions but does not require a fixed tuple length.
    if (Array.isArray(jsonSchema.prefixItems) && jsonSchema.items === undefined) {
      jsonSchema.minItems = jsonSchema.prefixItems.length;
      jsonSchema.maxItems = jsonSchema.prefixItems.length;
    }
  },
});
await writeFile(output, JSON.stringify(schema, null, 2) + '\n');
