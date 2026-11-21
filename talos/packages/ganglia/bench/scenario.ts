/**
 * ScenarioSpec is authored data; Scenario is loaded, reusable input plus resolved
 * cases and ordered training requests. A ScenarioBuilder owns materialization,
 * not measurement. Dataset bindings cross IPC; live geometry stays in the owning
 * worker. Resolve training before measurement filters, retain the same resource
 * handle for every query, and close kernels before releasing scenario resources.
 */
import type { Case } from '#@/bench/suite.ts';
import type { WorkerInput } from '#@/bench/workers.ts';

const scenarioBrand: unique symbol = Symbol('Scenario');
const resources = new WeakMap<Scenario, WorkerInput>();
type Input = Pick<
  WorkerInput,
  'metadata' | 'inputLoadMs' | 'timings' | 'recoverySetupMs' | 'catalogs'
>;

/** Loaded source inputs and resolved requests, retained for the whole benchmark. */
export interface Scenario<Test extends Case = Case> {
  readonly [scenarioBrand]: true;
  readonly id: string;
  readonly input: Input;
  readonly cases: readonly Test[];
  readonly training: readonly Case[];
  close(): Promise<void>;
}

export interface ScenarioBuilder<Dataset, Suite, Test extends Case = Case> {
  build(dataset: Dataset, suite: Suite): AsyncIterable<Scenario<Test>>;
}

/** Builders resolve training IDs before filtering the measured population. The
 * worker handle owns live scene objects; they never cross the IPC boundary. */
export function createScenario<Test extends Case>(
  id: string,
  input: WorkerInput,
  cases: readonly Test[],
  training: readonly Case[],
): Scenario<Test> {
  const scenario: Scenario<Test> = {
    [scenarioBrand]: true,
    id,
    input: {
      get metadata() {
        return input.metadata;
      },
      inputLoadMs: input.inputLoadMs,
      timings: input.timings,
      get recoverySetupMs() {
        return input.recoverySetupMs;
      },
      catalogs: input.catalogs,
    },
    cases: Object.freeze([...cases]),
    training: Object.freeze([...training]),
    close: () => input.solver.close(),
  };
  resources.set(scenario, input);
  return scenario;
}

// Framework-internal transport access. Scenario's caller-facing input view has
// no solve/train/phase controls, so callers cannot bypass the kernel typestate.
export function workerInput(scenario: Scenario): WorkerInput {
  return resources.get(scenario)!;
}
