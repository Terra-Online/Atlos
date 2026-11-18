/**
 * Bind each scenario's logical Suite input to a directory in the Dataset index
 * before starting workers. Selection filters measurement and leaves training
 * intact. Live geometry stays in the owning worker.
 */
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { parseInputIndex, type InputIndex } from '#@/bench/mechanisms/input-index.ts';
import type { Binding } from '#@/bench/mechanisms/scenario.ts';
import type { Case, Suite } from '#@/bench/mechanisms/suite.ts';
import { createScenario, type ScenarioBuilder } from '#@/bench/scenario.ts';
import type { Dataset as DatasetRoot } from '#@/bench/suite.ts';
import { prepareWorkerSolver } from '#@/bench/workers.ts';
import type { RouteQuery, SolverSettings } from '#@/src/solver/contract.ts';

interface Dataset extends DatasetRoot {
  inputs: InputIndex['inputs'];
}

export async function readDataset(root: string): Promise<Dataset> {
  const file = join(root, 'input-index.json');
  try {
    const { inputs } = parseInputIndex(JSON.parse(await readFile(file, 'utf8')));
    return { root, inputs };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid mechanism Dataset index ${file}: ${message}`, { cause: error });
  }
}

export async function scenarioBindings(
  dataset: Dataset,
  suite: Suite,
  suiteFile: string,
  selected: ReadonlySet<string>,
  prepareConfig?: string,
): Promise<ReadonlyMap<string, Binding>> {
  const bindings = new Map<string, Binding>();
  const errors: string[] = [];
  for (const spec of suite.scenarios) {
    if (!spec.cases.some((item) => selected.has(item.id))) continue;
    const training = new Set(spec.training);
    const cases = spec.cases.filter((item) => selected.has(item.id) || training.has(item.id));
    const input = spec.setup.input;
    const { scene } = input;
    const registered = Object.hasOwn(dataset.inputs, scene) ? dataset.inputs[scene] : undefined;
    const entry =
      input.kind === 'dynamic'
        ? registered?.dynamic
        : registered && Object.hasOwn(registered.regions, input.region)
          ? registered.regions[input.region]
          : undefined;
    if (!entry) {
      const label = input.kind === 'dynamic' ? 'dynamic input' : `fixed window ${input.region}`;
      errors.push(`${spec.id}: missing Dataset registration for ${scene} ${label}`);
      continue;
    }
    const { directory } = entry;
    const dataRoot = resolve(dataset.root, directory);
    const exports = join(dataset.root, 'routing');
    const required = [
      dataRoot,
      join(dataRoot, 'routing', `${scene}-ground-all.json`),
      join(dataRoot, 'routing', 'movement-settings-current.json'),
      join(exports, `${scene}-traversal-devices.json`),
    ];
    if (cases.some((item) => item.requirements?.projectStartToPhysicalSupport))
      required.push(join(exports, `${scene}-interaction-points.json`));
    const missing = await Promise.all(
      required.map(async (path) => {
        try {
          const info = await stat(path);
          return (path === dataRoot ? info.isDirectory() : info.isFile()) ? null : path;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT' || code === 'ENOTDIR') return path;
          throw error;
        }
      }),
    );
    const unavailable = missing.filter((path) => path !== null);
    if (unavailable.length) {
      errors.push(`${spec.id}: missing dataset input ${unavailable.join(', ')}`);
      continue;
    }
    bindings.set(spec.id, {
      suite: resolve(suiteFile),
      scenarioId: spec.id,
      ids: cases.map((item) => item.id),
      dataRoot,
      exports,
      prepareConfig,
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
        const source = spec.setup.input;
        const input = await prepareWorkerSolver({
          count: 1,
          config: options.config,
          dataRoot: file,
          extractor: options.extractor,
          scene: source.scene,
          entry: new URL('./worker.ts', import.meta.url),
          deferKernel: true,
          preparation:
            binding.prepareConfig && source.kind === 'dynamic'
              ? {
                  config: binding.prepareConfig,
                  devices: resolve(binding.exports, `${source.scene}-traversal-devices.json`),
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
