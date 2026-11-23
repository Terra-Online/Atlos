import { groundPlannerTopology } from '#@/src/v1/route/ground.ts';
import type { PhysicalCache } from '#@/src/v1/solver/physical/solve.ts';

export type CacheScope = { view: string; parent?: object };
export type CacheStats = {
  scope: 'cache-lifetime';
  hits: Record<string, number>;
  misses: Record<string, number>;
  evictions: Record<string, number>;
  capacity: { plannerSurfaces: number };
  resident: {
    views: number;
    ground: number;
    collision: number;
    devices: number;
    moving: number;
    refinement: number;
    plannerSurfaces: number;
  };
};
type Entry = { key: string; value: unknown; surfaces?: number; used?: number };
type Reason =
  | 'cold'
  | 'generation'
  | 'wall-view'
  | 'key-change'
  | 'dependency'
  | 'capacity'
  | 'surface-capacity'
  | 'explicit-release';
type View = {
  ground?: Entry;
  devices?: Entry;
  moving?: Entry;
  builds: Partial<Record<'ground' | 'devices' | 'moving' | 'refinement', symbol>>;
  pending: Partial<Record<'ground' | 'devices' | 'moving' | 'refinement', Reason>>;
};
type Refinement = Entry & { view: View; parent?: object };
const plannerSurfaceLimit = 524_288;

/** One immutable physical snapshot owns its preparations. Raw/rounded constraints
 * retain at most two coarse views; target refinements share a two-entry allowance.
 * All graph preparations also share a conservative surface-reference allowance.
 * Reserve before constructing a replacement, after releasing obsolete local
 * planner references. This bounds cache ownership, not memory owned by callers
 * or one graph's transient construction. It never limits search or input facts.
 * A view replacement does not invalidate independent sibling views or collision
 * preparation. Call begin with a new generation when any source/model facts change.
 */
export function createPhysicalCache() {
  const shared = new Map<'collision', Entry>();
  const views = new Map<string, View>();
  const refinements: Refinement[] = [];
  const reservations = new Set<{ surfaces: number }>();
  let generation: string | undefined;
  let epoch = 0;
  let active: string | undefined;
  let collisionBuild: symbol | undefined;
  let resetReason: Reason = 'cold';
  let clock = 0;
  const hits: Record<string, number> = {},
    misses: Record<string, number> = {},
    evictions: Record<string, number> = {};
  const count = (table: Record<string, number>, slot: string, reason?: Reason) => {
    const key = reason ? `${slot}:${reason}` : slot;
    table[key] = (table[key] ?? 0) + 1;
  };
  const dropRefinements = (view: View, reason: Reason) => {
    for (let i = refinements.length - 1; i >= 0; i--) {
      if (refinements[i].view !== view) continue;
      refinements.splice(i, 1);
      count(evictions, 'refinement', reason);
    }
    view.builds.refinement = Symbol();
    view.pending.refinement = reason;
  };
  const drop = (view: View, slot: 'devices' | 'moving', reason: Reason) => {
    if (view[slot]) count(evictions, slot, reason);
    delete view[slot];
    delete view.builds[slot];
    view.pending[slot] = reason;
  };
  const dropView = (key: string, view: View, reason: Reason) => {
    if (view.ground) count(evictions, 'ground', reason);
    delete view.ground;
    drop(view, 'devices', reason);
    drop(view, 'moving', reason);
    dropRefinements(view, reason);
    views.delete(key);
    if (active === key) active = undefined;
  };
  const plannerEntries = () => [
    ...[...views.values()].flatMap((view) =>
      (['ground', 'moving'] as const).flatMap((slot) => {
        const entry = view[slot];
        return entry ? [{ entry, view, slot }] : [];
      }),
    ),
    ...refinements.map((entry) => ({ entry, view: entry.view, slot: 'refinement' as const })),
  ];
  const trim = () => {
    const entries = plannerEntries().filter(({ entry }) => entry.surfaces);
    let surfaces = entries.reduce((sum, { entry }) => sum + entry.surfaces!, 0);
    for (const reservation of reservations) surfaces += reservation.surfaces;
    entries.sort((a, b) => a.entry.used! - b.entry.used!);
    for (const { entry, view, slot } of entries) {
      if (surfaces <= plannerSurfaceLimit) break;
      if (slot === 'refinement') refinements.splice(refinements.indexOf(entry as Refinement), 1);
      else delete view[slot];
      surfaces -= entry.surfaces!;
      count(evictions, slot, 'surface-capacity');
      view.pending[slot] = 'surface-capacity';
    }
  };
  const reset = (reason: Reason) => {
    epoch++;
    for (const [key, view] of views) dropView(key, view, reason);
    for (const slot of shared.keys()) count(evictions, slot, reason);
    shared.clear();
    collisionBuild = undefined;
    reservations.clear();
    active = undefined;
    resetReason = reason;
  };
  return {
    clear() {
      reset('explicit-release');
      generation = undefined;
    },
    begin(next: string) {
      if (generation !== undefined && generation !== next) reset('generation');
      generation = next;
    },
    release(slot: 'ground' | 'moving') {
      if (slot === 'ground') {
        for (const [key, view] of views) dropView(key, view, 'explicit-release');
      } else {
        for (const view of views.values()) {
          drop(view, 'moving', 'explicit-release');
          dropRefinements(view, 'explicit-release');
        }
      }
    },
    stats(): CacheStats {
      const entries = [...views.values()];
      return {
        scope: 'cache-lifetime',
        hits: { ...hits },
        misses: { ...misses },
        evictions: { ...evictions },
        capacity: { plannerSurfaces: plannerSurfaceLimit },
        resident: {
          views: views.size,
          ground: entries.filter((v) => v.ground).length,
          collision: Number(shared.has('collision')),
          devices: entries.filter((v) => v.devices).length,
          moving: entries.filter((v) => v.moving).length,
          refinement: refinements.length,
          plannerSurfaces: plannerEntries().reduce(
            (sum, { entry }) => sum + (entry.surfaces ?? 0),
            0,
          ),
        },
      };
    },
    async memo<T>(
      slot: Parameters<PhysicalCache['memo']>[0],
      key: string,
      create: (
        reserve?: (surfaces: number) => void,
        topologyFor?: (
          surfaces: Parameters<typeof groundPlannerTopology>[1],
        ) => ReturnType<typeof groundPlannerTopology>,
      ) => T | Promise<T>,
      scope?: CacheScope,
    ) {
      const version = epoch;
      const build = async (current = () => version === epoch, shareTopology = false) => {
        const reservation = { surfaces: 0 };
        reservations.add(reservation);
        try {
          const value = await create(
            (surfaces) => {
              if (!Number.isSafeInteger(surfaces) || surfaces < 0)
                throw new Error('Invalid preparation surface reservation');
              if (!current()) return;
              reservation.surfaces = surfaces;
              trim();
            },
            shareTopology
              ? (surfaces) => {
                  if (!current()) return undefined;
                  for (const view of views.values()) {
                    const topology = groundPlannerTopology(view.ground?.value, surfaces);
                    if (topology) return topology;
                  }
                  return undefined;
                }
              : undefined,
          );
          return { key, value, surfaces: reservation.surfaces, used: ++clock };
        } finally {
          reservations.delete(reservation);
        }
      };
      if (slot === 'collision') {
        const found = shared.get(slot);
        if (found?.key === key) {
          count(hits, slot);
          return { value: found.value as T, reused: true };
        }
        const reason = found ? 'key-change' : resetReason;
        count(misses, slot, reason);
        if (found) {
          count(evictions, slot, 'key-change');
          shared.delete(slot);
          for (const view of views.values()) {
            drop(view, 'devices', 'dependency');
            drop(view, 'moving', 'dependency');
            dropRefinements(view, 'dependency');
          }
        }
        const token = (collisionBuild = Symbol());
        const value = await create();
        if (version === epoch && collisionBuild === token) shared.set(slot, { key, value });
        return { value, reused: false };
      }
      if (slot === 'ground') {
        let view = views.get(key);
        active = key;
        if (view?.ground) {
          // Two-view LRU bounds residency when callers use additional constraint
          // contexts; switching to an already resident view has no child effects.
          views.delete(key);
          views.set(key, view);
          view.ground.used = ++clock;
          count(hits, slot);
          return { value: view.ground.value as T, reused: true };
        }
        let reason: Reason = view?.pending.ground ?? (views.size ? 'wall-view' : resetReason);
        if (!view) {
          if (views.size >= 2) {
            const [oldKey, oldView] = views.entries().next().value!;
            dropView(oldKey, oldView, 'capacity');
            reason = 'capacity';
          }
          view = { pending: {}, builds: {} };
          views.set(key, view);
        }
        count(misses, slot, reason);
        delete view.pending.ground;
        const token = (view.builds.ground = Symbol());
        const current = () =>
          version === epoch && views.get(key) === view && view.builds.ground === token;
        try {
          const entry = await build(current, true);
          if (current()) {
            view.ground = entry;
            trim();
          }
          return { value: entry.value, reused: false };
        } catch (error) {
          if (current() && !view.ground) dropView(key, view, 'dependency');
          throw error;
        }
      }
      const viewKey = scope?.view ?? active;
      const view = viewKey === undefined ? undefined : views.get(viewKey);
      // An in-flight caller can outlive a capacity eviction. Its result remains
      // valid for that caller, but cannot be attached to another query's view.
      if (!view) {
        count(misses, slot, 'capacity');
        return { value: (await build(() => false)).value, reused: false };
      }
      if (slot === 'refinement') {
        const found = refinements.find(
          (entry) => entry.view === view && entry.key === key && entry.parent === scope?.parent,
        );
        if (found) {
          found.used = ++clock;
          count(hits, slot);
          return { value: found.value as T, reused: true };
        }
        count(
          misses,
          slot,
          view.pending.refinement ??
            (refinements.some((r) => r.view === view) ? 'key-change' : resetReason),
        );
        delete view.pending.refinement;
        // Make room before construction, rather than briefly retaining a third
        // complete target graph while the replacement is being built.
        if (refinements.length >= 2) {
          refinements.shift();
          count(evictions, slot, 'capacity');
        }
        const revision = view.builds.refinement;
        const current = () =>
          version === epoch && views.get(viewKey!) === view && view.builds.refinement === revision;
        const entry = await build(current);
        if (current()) {
          if (refinements.length >= 2) {
            refinements.shift();
            count(evictions, slot, 'capacity');
          }
          refinements.push({ ...entry, view, parent: scope?.parent });
          trim();
        }
        return { value: entry.value, reused: false };
      }
      let found = view[slot];
      if (found?.key === key) {
        found.used = ++clock;
        count(hits, slot);
        return { value: found.value as T, reused: true };
      }
      count(misses, slot, view.pending[slot] ?? (found ? 'key-change' : resetReason));
      delete view.pending[slot];
      if (found) {
        count(evictions, slot, 'key-change');
        delete view[slot];
        if (slot === 'devices') drop(view, 'moving', 'dependency');
        dropRefinements(view, 'dependency');
      }
      // Do not keep a replaced graph alive in this async frame during its rebuild.
      found = undefined;
      const token = (view.builds[slot] = Symbol());
      const current = () =>
        version === epoch && views.get(viewKey!) === view && view.builds[slot] === token;
      const entry = await build(current);
      if (current()) {
        view[slot] = entry;
        trim();
      }
      return { value: entry.value, reused: false };
    },
  } satisfies PhysicalCache & {
    clear(): void;
    begin(generation: string): void;
    stats(): CacheStats;
  };
}
