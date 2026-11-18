/**
 * A dataset binds static exports to a game build, player profiles and case IDs.
 * The suite digest identifies the run's manifest in its report. An existing
 * dataset can serve a revised manifest with compatible input bindings.
 * Before workers start, resolve each selected scenario's full training set and
 * selected measurement cases against one input directory. Different world setups
 * may share that directory, but never a mutable solver kernel. Input indexes
 * may explicitly bind absolute retained directories as well as root-relative
 * ones. Live geometry and callbacks stay in the owning worker.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type { Binding } from '#@/bench/mechanisms/scenario.ts';
import type { Case, Suite } from '#@/bench/mechanisms/suite.ts';
import { createScenario, type ScenarioBuilder } from '#@/bench/scenario.ts';
import type { Dataset as StaticDataset } from '#@/bench/suite.ts';
import { prepareWorkerSolver } from '#@/bench/workers.ts';
import type { RouteQuery, SolverSettings } from '#@/src/solver/contract.ts';

export interface Dataset extends StaticDataset {
  readonly revision: string;
  readonly suiteSha256: string;
  readonly indexSha256: string;
  readonly cases: Readonly<Record<string, { directory: string }>>;
}

export async function loadDataset(root: string, suiteFile: string, suite: Suite): Promise<Dataset> {
  const bytes = await readFile(join(root, 'input-index.json'));
  const index: unknown = JSON.parse(bytes.toString());
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  if (
    !record(index) ||
    typeof index.revision !== 'string' ||
    !index.revision ||
    !record(index.profiles) ||
    !record(index.cases)
  )
    throw new Error('Invalid mechanism input index');
  const profiles = index.profiles;
  const suiteSha256 = createHash('sha256')
    .update(await readFile(suiteFile))
    .digest('hex');
  if (
    !isDeepStrictEqual(index.source, suite.source) ||
    Object.entries(suite.sources).some(
      ([scene, source]) => !isDeepStrictEqual(profiles[scene], source.profile),
    )
  )
    throw new Error(
      'Candidate game build and player profiles must match the mechanism specification',
    );
  const cases = Object.fromEntries(
    Object.entries(index.cases).map(([id, binding]) => {
      if (!record(binding) || typeof binding.directory !== 'string' || !binding.directory)
        throw new Error(`Invalid input directory binding for case: ${id}`);
      return [id, { directory: binding.directory }];
    }),
  );
  return {
    root: resolve(root),
    revision: index.revision,
    suiteSha256,
    indexSha256: createHash('sha256').update(bytes).digest('hex'),
    cases,
  };
}

export function scenarioBindings(
  dataset: Dataset,
  suite: Suite,
  suiteFile: string,
  selected: ReadonlySet<string>,
  prepareConfig?: string,
): ReadonlyMap<string, Binding> {
  const bindings = new Map<string, Binding>();
  const errors: string[] = [];
  for (const spec of suite.scenarios) {
    if (!spec.cases.some((item) => selected.has(item.id))) continue;
    const training = new Set(spec.training);
    const ids = spec.cases
      .filter((item) => selected.has(item.id) || training.has(item.id))
      .map((item) => item.id);
    const directories = new Map<string, string[]>();
    const missing: string[] = [];
    for (const id of ids) {
      const directory = dataset.cases[id]?.directory;
      if (!directory) {
        missing.push(id);
        continue;
      }
      const path = resolve(dataset.root, directory);
      const cases = directories.get(path);
      if (cases) cases.push(id);
      else directories.set(path, [id]);
    }
    if (missing.length)
      errors.push(`${spec.id}: missing dataset directory for ${missing.join(', ')}`);
    if (directories.size > 1) {
      const details = [...directories].map(([path, cases]) => `${cases.join(', ')} → ${path}`);
      errors.push(`${spec.id}: Cases bind different dataset directories: ${details.join('; ')}`);
    }
    if (missing.length || directories.size > 1) continue;
    const [dataRoot] = directories.keys();
    bindings.set(spec.id, {
      suite: resolve(suiteFile),
      ids,
      dataRoot,
      exports: join(dataset.root, 'routing'),
      prepareConfig,
      inputRevision: dataset.revision,
    });
  }
  if (errors.length) throw new Error('Invalid mechanism input bindings:\n' + errors.join('\n'));
  return bindings;
}

export function scenarioBuilder(options: {
  config: SolverSettings;
  extractor: string;
  selected: ReadonlySet<string>;
  writeBinding: (id: string, binding: Binding) => string;
  onInputError: (item: Case, error: { status: string; reason: string }) => void;
  onResult?: Parameters<typeof prepareWorkerSolver>[0]['onResult'];
}): ScenarioBuilder<ReadonlyMap<string, Binding>, Suite, Case> {
  return {
    async *build(bindings, suite) {
      const byId = new Map(suite.cases.map((item) => [item.id, item]));
      for (const spec of suite.scenarios) {
        const measured = spec.cases.filter((item) => options.selected.has(item.id));
        if (!measured.length) continue;
        const binding = bindings.get(spec.id);
        if (!binding) throw new Error(`Missing prepared input binding for ${spec.id}`);
        const file = options.writeBinding(spec.id, binding);
        const first = byId.get(binding.ids[0])!;
        const input = await prepareWorkerSolver({
          count: 1,
          config: options.config,
          dataRoot: file,
          extractor: options.extractor,
          scene: first.scene,
          entry: new URL('./worker.ts', import.meta.url),
          deferKernel: true,
          preparation:
            binding.prepareConfig && !first.setup.physical
              ? {
                  config: binding.prepareConfig,
                  devices: resolve(binding.exports, `${first.scene}-traversal-devices.json`),
                }
              : undefined,
          onResult: options.onResult,
        });
        try {
          const metadata = input.metadata as typeof input.metadata & {
            mechanism: {
              resolved: Record<string, RouteQuery>;
              resolutionErrors: Record<string, { status: string; reason: string }>;
            };
          };
          const resolveCase = (id: string) => {
            const error = metadata.mechanism.resolutionErrors[id];
            if (error) return undefined;
            const item = byId.get(id)!;
            return { ...item, query: metadata.mechanism.resolved[id] };
          };
          for (const item of measured) {
            const error = metadata.mechanism.resolutionErrors[item.id];
            if (error) options.onInputError(byId.get(item.id)!, error);
          }
          const cases = measured.flatMap((item) => {
            const test = resolveCase(item.id);
            return test ? [test] : [];
          });
          const training = spec.training.map((id) => {
            const test = resolveCase(id);
            if (!test) throw new Error(`Training case could not be resolved: ${id}`);
            return test;
          });
          if (!cases.length) {
            await input.solver.close();
            continue;
          }
          yield createScenario(spec.id, input, cases, training);
        } catch (error) {
          await input.solver.close();
          throw error;
        }
      }
    },
  };
}
