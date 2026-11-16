// Stable command entry and input-grouping export for dataset preparation.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { main } from '#@/bench/mechanisms/prepare.ts';
export { inputGroups } from '#@/bench/mechanisms/prepare.ts';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
