import type {
  PreparedRouteSolver,
  RouteQuery,
  RouteResult,
  SolveOptions,
  SolverInput,
} from '#@/src/solver/contract.ts';
import type { GangliaV1Config } from '#@/src/solver/ganglia-v1.ts';
import type { Corridor, WindowJob, WindowRequest } from '#@/src/solver/resources.ts';

interface NativeEngine {
  start(query: string): string;
  resume(response: string): string;
  close(): void;
  cancel(): void;
  catalogPhase(phase: string): void;
  catalogStats(): string;
}
type NativeModule = { NativeEngine: new (config: string, input: string) => NativeEngine };
type Step =
  | { type: 'complete'; result: RouteResult }
  | {
      type: 'load';
      effect: { partial?: RouteResult } & (
        | { id: number; kind: 'terminals'; query: RouteQuery }
        | {
            kind: 'window';
            id: number;
            start: number[];
            target: number[];
            margin: number;
            corridor: Corridor;
            arrival: WindowRequest['arrival'];
            interaction?: WindowRequest['interaction'];
            waypoints?: WindowRequest['waypoints'];
          }
      );
    };

// Typed geometry buffers cross the native seam as arrays. No solver callbacks
// are serialized: Rust returns effects and the host fulfills their async IO.
const encode = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) =>
    ArrayBuffer.isView(item) && !(item instanceof DataView)
      ? Array.from(item as unknown as ArrayLike<number>)
      : item,
  );
function loadNative(): NativeModule {
  if (typeof process === 'undefined' || !process.getBuiltinModule)
    throw new Error('ganglia-v1-rust requires the Node native host');
  const { createRequire } = process.getBuiltinModule('node:module');
  return createRequire(import.meta.url)(rustLibraryPath()) as NativeModule;
}

export function rustLibraryPath(): string {
  const { fileURLToPath } = process.getBuiltinModule('node:url');
  return (
    process.env.GANGLIA_V1_RUST_LIBRARY ??
    fileURLToPath(
      new URL('../../../../../.local/cache/ganglia-v1/ganglia-v1.node', import.meta.url),
    )
  );
}

export interface RustPreparedSolver extends PreparedRouteSolver<GangliaV1Config> {
  setCatalogPhase(phase: 'disabled' | 'training' | 'frozen'): void;
  catalogStats(): Record<string, unknown>;
}

export async function prepareGangliaV1Rust<Source, Job extends WindowJob>(
  config: GangliaV1Config,
  input: SolverInput<Source, Job>,
): Promise<RustPreparedSolver> {
  config = Object.freeze({ ...config });
  if (input.kind === 'scene' && !input.resources.physical)
    throw new Error('ganglia-v1-rust scene resources require raw physical snapshots');
  const facts =
    input.kind === 'scene'
      ? {
          kind: input.kind,
          scene: {
            scene: input.scene.scene,
            walls: input.scene.walls,
            navigation: input.scene.navigation,
          },
          locomotion: input.locomotion,
        }
      : input;
  const { NativeEngine } = loadNative();
  const engine = new NativeEngine(encode(config), encode(facts));
  let closing = false;
  let closePromise: Promise<void> | undefined;
  let tail = Promise.resolve();
  // Mirror the engine's bounded prepared-world ownership. A reference is valid
  // only for the complete revision and coverage identity resident in this engine.
  const resident = new Map<string, true>();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    if (closing) return Promise.reject(new Error('Prepared solver is closed'));
    const result = tail.then(work);
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  };
  const solve = (query: RouteQuery, options?: SolveOptions) =>
    enqueue(async () => {
      try {
        options?.signal?.throwIfAborted();
        options?.onEvent?.({ type: 'progress', phase: 'prepare' });
        let step = JSON.parse(engine.start(encode(query))) as Step;
        while (step.type === 'load') {
          options?.signal?.throwIfAborted();
          if (input.kind !== 'scene')
            throw new Error('Native solver requested scene IO without a scene');
          const effect = step.effect;
          if (effect.partial)
            options?.onEvent?.({ type: 'candidate', result: effect.partial, optimizing: true });
          options?.signal?.throwIfAborted();
          let response: unknown;
          let loadedKey: string | undefined;
          if (effect.kind === 'terminals') {
            response = {
              id: effect.id,
              terminals: (await input.resources.terminals?.(effect.query)) ?? [],
            };
          } else {
            const load = () =>
              input.resources.query(
                input.scene.scene,
                input.scene.source,
                effect.start,
                effect.target,
                { startBuild: true, margin: effect.margin, corridor: effect.corridor },
              );
            let job = await load();
            while (job && job.status !== 'ready' && job.status !== 'failed') {
              await input.resources.wait(options?.signal);
              options?.signal?.throwIfAborted();
              job = await load();
            }
            options?.signal?.throwIfAborted();
            if (!job || job.status === 'failed')
              response = { id: effect.id, error: job?.message ?? 'Physical snapshot unavailable' };
            else {
              const request: WindowRequest & { source: Source } = {
                scene: input.scene.scene,
                source: input.scene.source,
                arrival: effect.arrival,
                target: effect.target as WindowRequest['target'],
                interaction: effect.interaction,
                walls: input.scene.walls,
                waypoints: effect.waypoints,
                solverConfig: config,
              };
              const snapshot = await input.resources.physical!(job, request);
              const coverage =
                snapshot.coverage === 'complete'
                  ? { kind: 'complete' }
                  : { kind: 'sparse', ...snapshot.coverage };
              loadedKey = encode([snapshot.revision, coverage]);
              response = {
                id: effect.id,
                snapshot: resident.has(loadedKey)
                  ? { cached: true }
                  : { kind: 'physical', input: snapshot.input },
                revision: snapshot.revision,
                coverage,
              };
            }
          }
          options?.signal?.throwIfAborted();
          options?.onEvent?.({ type: 'progress', phase: 'search' });
          step = JSON.parse(engine.resume(encode(response))) as Step;
          if (loadedKey !== undefined) {
            resident.delete(loadedKey);
            resident.set(loadedKey, true);
            if (resident.size > 4) resident.delete(resident.keys().next().value!);
          }
        }
        options?.signal?.throwIfAborted();
        options?.onEvent?.({ type: 'candidate', result: step.result, optimizing: false });
        return step.result;
      } catch (error) {
        // Resume can prepare and evict a native world before search throws.
        // Re-send full facts after failure instead of trusting a stale mirror.
        resident.clear();
        // Release a suspended query after cancellation or failed host IO so the
        // next submission starts with fresh query state.
        engine.cancel();
        throw error;
      }
    });
  return {
    config,
    solve,
    solveBatch: (queries, options) =>
      closing
        ? Promise.reject(new Error('Prepared solver is closed'))
        : Promise.all(queries.map((query) => solve(query, options))),
    setCatalogPhase: (phase) => engine.catalogPhase(phase),
    catalogStats: () => JSON.parse(engine.catalogStats()) as Record<string, unknown>,
    close() {
      if (!closePromise) {
        closing = true;
        closePromise = tail.then(async () => {
          engine.close();
          if (input.kind === 'scene') await input.resources.close?.();
        });
      }
      return closePromise;
    },
  };
}
