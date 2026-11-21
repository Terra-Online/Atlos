/**
 * Ordinary suites describe queries in one source scene. The builder keeps loaded
 * worker resources alive across training and all measured rounds. Dataset paths
 * are static bindings; solver configuration and worker options are fixed when
 * the builder is created and cannot be overridden by individual cases.
 */
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

import type { RouteQuery } from '@opendfieldmap/ganglia';

import type { BenchmarkAdapter } from '#@/bench/adapter.ts';
import { createScenario, type ScenarioBuilder } from '#@/bench/scenario.ts';
import {
  cases as stressCases,
  maximumSpanCases,
  connectedLongCases,
} from '#@/bench/scenes/map02-long-range.ts';
import { cases as localCases } from '#@/bench/scenes/map02.ts';
import type { Case, Dataset, Suite } from '#@/bench/suite.ts';
import { prepareWorkerSolver } from '#@/bench/workers.ts';

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

export async function readWorkload(name = 'map02'): Promise<Workload & { suiteId: string }> {
  if (name === 'mechanisms')
    throw new Error(
      'Scenario manifests require benchmark:mechanisms for service scoring or bench/mechanism-run.ts for native route diagnostics',
    );
  if (Object.hasOwn(presets, name)) return { ...presets[name], suiteId: name };
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
  return { cases, directory: '', suiteId: 'custom' };
}

type SceneSuite = Suite<{ readonly scene: string }>;

export function sceneSuite(
  scene: string,
  cases: readonly Case[],
  training: readonly Case[],
): SceneSuite {
  const requests = new Map<string, Case>();
  for (const item of [...cases, ...training]) {
    const previous = requests.get(item.id);
    if (previous && !isDeepStrictEqual(previous.query, item.query))
      throw new Error(`Conflicting training and measured case ID: ${item.id}`);
    if (!previous) requests.set(item.id, item);
  }
  return {
    id: scene,
    scenarios: [
      {
        id: scene,
        setup: { scene },
        cases: [...requests.values()],
        training: training.map((item) => item.id),
      },
    ],
  };
}

export function sceneBuilder(options: {
  adapter: BenchmarkAdapter;
  config: import('#@/src/solver/contract.ts').SolverSettings;
  extractor: string;
  workers: number;
  measured: ReadonlySet<string>;
  onResult?: Parameters<typeof prepareWorkerSolver>[0]['onResult'];
}): ScenarioBuilder<Dataset, SceneSuite> {
  return {
    async *build(dataset, suite) {
      for (const spec of suite.scenarios) {
        const byId = new Map(spec.cases.map((item) => [item.id, item]));
        const training = spec.training.map((id) => {
          const item = byId.get(id);
          if (!item) throw new Error(`Unknown training case: ${id}`);
          return item;
        });
        const cases = spec.cases.filter((item) => options.measured.has(item.id));
        if (!cases.length) continue;
        const input = await prepareWorkerSolver({
          count: options.workers,
          config: options.config,
          entry: options.adapter.entry,
          dataRoot: dataset.root,
          extractor: options.extractor,
          scene: spec.setup.scene,
          onResult: options.onResult,
          deferKernel:
            options.adapter.entry.href ===
            new URL('./adapters/ganglia-v1/worker.ts', import.meta.url).href,
        });
        yield createScenario(spec.id, input, cases, training);
      }
    },
  };
}
