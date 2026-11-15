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
      'Use benchmark:mechanisms for scenario setup, training and mechanism acceptance',
    );
  if (presets[name]) return presets[name];
  const cases: unknown = JSON.parse(await readFile(name, 'utf8'));
  if (!Array.isArray(cases))
    throw new Error(
      'Scenario manifests require benchmark:mechanisms; --workload expects a query array',
    );
  return { cases, directory: '' };
}
