import { readFile } from 'node:fs/promises';

import type { RouteQuery } from '@opendfieldmap/ganglia';

import {
  cases as stressCases,
  maximumSpanCases,
  connectedLongCases,
} from '#@/bench/scenes/map02-long-range.ts';
import { cases as localCases } from '#@/bench/scenes/map02.ts';

type Workload = {
  cases: { id: string; query: RouteQuery; horizontalDistance?: number }[];
  directory: string;
};
const presets: Record<string, Workload> = {
  map02: { cases: localCases, directory: '' },
  'map02-long-range': { cases: maximumSpanCases, directory: 'long-range-map02-packed' },
  'map02-long-detours': { cases: connectedLongCases, directory: 'long-range-map02-packed' },
  'map02-stress': { cases: stressCases, directory: 'long-range-map02-packed' },
};

export async function readWorkload(name = 'map02'): Promise<Workload> {
  if (name === 'mechanisms')
    throw new Error(
      'Scenario manifests require benchmark:mechanisms for service scoring or bench/mechanism-run.ts for native route diagnostics',
    );
  if (presets[name]) return presets[name];
  const cases: unknown = JSON.parse(await readFile(name, 'utf8'));
  if (
    !Array.isArray(cases) ||
    cases.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        ('setup' in item || 'scene' in item || 'assertions' in item),
    )
  )
    throw new Error(
      'Scenario manifests require bench/mechanism-run.ts; do not discard scene/setup to score them as query arrays',
    );
  return { cases, directory: '' };
}
