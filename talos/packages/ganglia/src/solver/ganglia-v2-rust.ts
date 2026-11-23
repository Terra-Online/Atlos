import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import type { Vec3 } from '#@/src/geometry.ts';
import type {
  PreparedRouteSolver,
  RouteQuery,
  RouteResult,
  SolveOptions,
} from '#@/src/solver/contract.ts';
import type { GangliaV2Config, NavigationMark, V2Diagnostics } from '#@/src/solver/ganglia-v2.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';

export { gangliaV2Defaults } from '#@/src/solver/ganglia-v2.ts';
export type { GangliaV2Config, NavigationMark } from '#@/src/solver/ganglia-v2.ts';

interface NativeEngine {
  solve(query: string): Promise<string>;
  cancel(): void;
  stats(): string;
}

export interface V2Result extends RouteResult {
  diagnostics: RouteResult['diagnostics'] & { v2: V2Diagnostics };
}

export interface V2PreparedSolver extends PreparedRouteSolver<GangliaV2Config> {
  solve(query: RouteQuery, options?: SolveOptions): Promise<V2Result>;
  preparationStats(): Record<string, unknown>;
}

export function gangliaV2LibraryPath(): string {
  return (
    process.env.GANGLIA_V2_RUST_LIBRARY ??
    fileURLToPath(
      new URL('../../../../../.local/cache/ganglia-v2/ganglia-v2.node', import.meta.url),
    )
  );
}

const encode = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) =>
    ArrayBuffer.isView(item) && !(item instanceof DataView)
      ? Array.from(item as unknown as ArrayLike<number>)
      : item,
  );

/** Builds immutable backbones for a bounded set of complete source-box layouts. Native query work runs off the JS thread so
 * benchmark cancellation remains observable while optimization is in progress. */
export async function prepareGangliaV2(
  config: GangliaV2Config,
  physical: PhysicalInput,
  marks: readonly NavigationMark[],
  anchors: readonly Vec3[] = [],
  layouts: readonly (readonly { device: string; position: Vec3 }[])[] = [],
  links: readonly { from: Vec3; to: Vec3 }[] = [],
): Promise<V2PreparedSolver> {
  const { NativeEngine } = createRequire(import.meta.url)(gangliaV2LibraryPath()) as {
    NativeEngine: new (
      input: string,
      surfaces: string[],
      positions: Float64Array,
      indices: Float64Array,
    ) => NativeEngine;
  };
  const settings = Object.freeze({ ...config });
  // A physical snapshot can exceed V8's single-string limit. Keep mesh buffers
  // binary and bound each navigation JSON allocation independently of map size.
  const surfaces: string[] = [];
  for (let start = 0; start < physical.ground.surfaces.length; start += 1024) {
    surfaces.push(encode(physical.ground.surfaces.slice(start, start + 1024)));
  }
  const { positions, indices } = physical.collision;
  let engine: NativeEngine | undefined = new NativeEngine(
    encode({
      physical: {
        ...physical,
        ground: { ...physical.ground, surfaces: [] },
        collision: { positions: [], indices: [] },
      },
      marks,
      anchors,
      layouts,
      links,
      config: settings,
    }),
    surfaces,
    positions instanceof Float64Array ? positions : Float64Array.from(positions),
    Float64Array.from(indices),
  );
  const stats = JSON.parse(engine.stats()) as Record<string, unknown>;
  let closing = false;
  let tail = Promise.resolve();
  let closePromise: Promise<void> | undefined;
  const solve = (query: RouteQuery, options?: SolveOptions): Promise<V2Result> => {
    if (closing) return Promise.reject(new Error('Prepared solver is closed'));
    const work = tail.then(async () => {
      const active = engine!;
      const abort = () => active.cancel();
      options?.signal?.addEventListener('abort', abort, { once: true });
      try {
        options?.signal?.throwIfAborted();
        options?.onEvent?.({ type: 'progress', phase: 'search' });
        options?.signal?.throwIfAborted();
        const result = JSON.parse(await active.solve(encode(query))) as V2Result;
        options?.signal?.throwIfAborted();
        options?.onEvent?.({ type: 'candidate', result, optimizing: false });
        return result;
      } catch (error) {
        options?.signal?.throwIfAborted();
        throw error;
      } finally {
        options?.signal?.removeEventListener('abort', abort);
      }
    });
    tail = work.then(
      () => {},
      () => {},
    );
    return work;
  };
  return {
    config: settings,
    solve,
    solveBatch: (queries, options) =>
      closing
        ? Promise.reject(new Error('Prepared solver is closed'))
        : Promise.all(queries.map((query) => solve(query, options))),
    preparationStats: () => structuredClone(stats),
    close() {
      if (!closePromise) {
        closing = true;
        closePromise = tail.then(() => {
          engine = undefined;
        });
      }
      return closePromise;
    },
  };
}
