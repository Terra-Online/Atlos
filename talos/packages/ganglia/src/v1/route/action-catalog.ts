import type { CollisionWorld } from '#@/src/collision.ts';
import type { Portal, Surface, Vec3 } from '#@/src/geometry.ts';
import type { GroundArrival, GroundConnection } from '#@/src/route.ts';
import { condenseComponents } from '#@/src/v1/reach/connectivity.ts';
import { groundPreparation } from '#@/src/v1/route/ground.ts';
import type { JumpRouteOptions } from '#@/src/v1/route/jump-planner.ts';
import { createMinHeap } from '#@/src/v1/search/heap.ts';

type Phase = 'disabled' | 'training' | 'frozen';
let phase: Phase = 'disabled';
const counts = {
  scopes: 0,
  scopeResets: 0,
  missingSupport: 0,
  frozenScopeMisses: 0,
  added: 0,
  duplicates: 0,
  evicted: 0,
  frozenCalls: 0,
  selections: 0,
  selectedEdges: 0,
  seedSelections: 0,
  seededEdges: 0,
  seededComponents: 0,
  candidateChains: 0,
  rankedStates: 0,
  hits: 0,
  misses: 0,
};
export const setActionCatalogPhase = (next: Phase) => {
  phase = next;
};
export const isActionCatalogFrozen = () => phase === 'frozen';
// Only semantic bank changes invalidate failure proofs; query counters do not.
export const catalogEvidenceRevision = () =>
  phase === 'training'
    ? undefined
    : ([phase, counts.added, counts.evicted, counts.scopeResets, counts.scopes] as const);
export const actionCatalogStats = () => ({
  phase,
  ...counts,
  fallbacks: counts.frozenCalls - counts.hits,
});
export const noteActionCatalogResult = (complete: boolean) => {
  if (complete) counts.hits++;
  else counts.misses++;
};

const copy = (action: GroundConnection): GroundConnection => ({
  ...action,
  points: action.points.map((point): Vec3 => [...point]),
  times: [...action.times],
});
interface Proof {
  action: GroundConnection;
  from: Surface;
  to: Surface;
}
interface Bank {
  actions: Map<string, Proof>;
}
type ActionAdjacency = Map<number, { to: number; action: GroundConnection }[]>;
interface LocalBank extends Bank {
  id: number;
  serial: number;
}
let nextLocalId = 0;
interface Scope {
  signature: string;
  portals: Portal[] | undefined;
  shared: Bank;
  local: WeakMap<Surface[], LocalBank>;
  graphs: WeakMap<
    NonNullable<ReturnType<typeof groundPreparation>>,
    {
      topology: ReturnType<typeof condenseComponents>;
      walking: Map<number, Set<number>>;
      banks: WeakMap<Bank, ActionAdjacency>;
    }
  >;
}
const worlds = new WeakMap<CollisionWorld, WeakMap<Surface[], Scope>>();
interface SupportLineage {
  owner: Surface[];
  byId: Map<string, Surface>;
}
const owners = new WeakMap<Surface[], SupportLineage>();
const snapshots = new WeakMap<
  Surface[],
  { lineage: SupportLineage; portals: Portal[] | undefined }
>();

/** Register immutable coarse support ancestry. Goal refinements may append faces,
 * but only unchanged coarse endpoints can carry physical proofs between snapshots.
 * Dynamic support snapshots must remain unregistered. The immutable imported
 * portal owner scopes the bank; refinement-generated portals belong to its live graph.
 */
export function registerCatalogSurfaces(
  current: Surface[],
  coarseOwner: Surface[] | null,
  portals?: Portal[],
) {
  if (phase === 'disabled') return;
  if (!coarseOwner) {
    snapshots.delete(current);
    return;
  }
  let lineage = owners.get(coarseOwner);
  if (!lineage) {
    lineage = { owner: coarseOwner, byId: new Map(coarseOwner.map((face) => [face.id, face])) };
    owners.set(coarseOwner, lineage);
  }
  snapshots.set(current, { lineage, portals });
}

function scopeFor(
  world: CollisionWorld,
  surfaces: Surface[],
  options: JumpRouteOptions,
): Scope | undefined {
  if (
    phase === 'disabled' ||
    options.activeBoost !== undefined ||
    options.boosts?.length ||
    options.interaction?.airborne ||
    options.connections?.some(
      (action) =>
        action.traversal ||
        action.requiredBoost ||
        action.terminal ||
        !['jump', 'drop'].includes(action.mode),
    )
  )
    return undefined;
  const snapshot = snapshots.get(surfaces);
  const prepared = groundPreparation(options.groundPlanner);
  if (!snapshot || !prepared || prepared.surfaces !== surfaces) {
    counts.missingSupport++;
    return undefined;
  }
  const { lineage, portals } = snapshot;
  const signature = JSON.stringify([
    options.model,
    options.profile,
    options.walls,
    options.maxSlope,
    options.maxVertical,
    options.maxDrop,
    options.maxHorizontalDistance,
    options.runAirSpeed,
    options.speed,
    options.locomotion,
  ]);
  let supports = worlds.get(world);
  if (!supports) {
    supports = new WeakMap();
    worlds.set(world, supports);
  }
  let scope = supports.get(lineage.owner);
  if (!scope || scope.signature !== signature || scope.portals !== portals) {
    if (phase === 'frozen') {
      counts.frozenScopeMisses++;
      return undefined;
    }
    if (scope) counts.scopeResets++;
    counts.scopes++;
    scope = {
      signature,
      portals,
      shared: { actions: new Map() },
      local: new WeakMap(),
      graphs: new WeakMap(),
    };
    supports.set(lineage.owner, scope);
  }
  return scope;
}

/** Store motion proofs, including ones not used by a selected route. Training
 * runs the original discovery algorithm; frozen queries cannot add any edges.
 * Exact snapshots retain their refined endpoints; only coarse ancestry permits
 * a proof to enter the bank shared between goal refinements.
 */
export function rememberCatalogAction(
  world: CollisionWorld,
  surfaces: Surface[],
  options: JumpRouteOptions,
  action: GroundConnection,
) {
  if (
    phase !== 'training' ||
    action.state !== 'open' ||
    !['jump', 'drop'].includes(action.mode) ||
    action.terminal ||
    action.requiredBoost !== undefined ||
    action.traversal !== undefined ||
    action.fromSurface === undefined ||
    action.toSurface === undefined
  )
    return;
  const scope = scopeFor(world, surfaces, options);
  if (!scope) return;
  const lineage = snapshots.get(surfaces)!.lineage;
  const prepared = groundPreparation(options.groundPlanner)!;
  const from = prepared.byId.get(action.fromSurface),
    to = prepared.byId.get(action.toSurface);
  if (!from || !to) return;
  let local = scope.local.get(surfaces);
  if (!local) {
    local = { id: nextLocalId++, serial: 0, actions: new Map() };
    scope.local.set(surfaces, local);
  }
  const { id: _id, ...motion } = action;
  const key = JSON.stringify(motion);
  let stored = local.actions.get(key);
  if (stored) counts.duplicates++;
  else {
    stored = {
      action: copy({ ...action, id: `@catalog/${local.id}/${local.serial++}` }),
      from,
      to,
    };
    retain(local, key, stored);
    counts.added++;
  }
  // Preserve the exact snapshot's insertion order and IDs before publishing its
  // coarse-only subset. Extra shared edges must not displace local candidates.
  if (
    lineage.byId.get(from.id) === from &&
    lineage.byId.get(to.id) === to &&
    !scope.shared.actions.has(key)
  )
    retain(scope.shared, key, { action: copy(stored.action), from, to });
  scope.graphs = new WeakMap();
}

function retain(bank: Bank, key: string, proof: Proof) {
  if (bank.actions.size >= 2048) {
    bank.actions.delete(bank.actions.keys().next().value!);
    counts.evicted++;
  }
  bank.actions.set(key, proof);
}

interface CatalogSelection {
  actions: GroundConnection[];
  seeds: GroundConnection[];
}

/** Select several positive chains by estimated travel time, retaining at most
 * sixteen actions. SCC walking ignores exact entry cost and resource state, so
 * only a fresh GroundPlanner solve may accept their combined action set.
 * A miss makes no reachability claim and leaves original discovery available.
 */
export function selectCatalogActions(
  world: CollisionWorld,
  surfaces: Surface[],
  starts: GroundArrival[],
  goal: Vec3,
  options: JumpRouteOptions,
): CatalogSelection {
  if (phase !== 'frozen') return { actions: [], seeds: [] };
  counts.frozenCalls++;
  const scope = scopeFor(world, surfaces, options);
  if (!scope) return { actions: [], seeds: [] };
  const local = scope.local.get(surfaces);
  const selected = local && rankActions(scope, local, starts, goal, options);
  return selected?.actions.length
    ? selected
    : rankActions(scope, scope.shared, starts, goal, options, true);
}

function rankActions(
  scope: Scope,
  bank: Bank,
  starts: GroundArrival[],
  goal: Vec3,
  options: JumpRouteOptions,
  collectSeeds = false,
): CatalogSelection {
  if (!bank.actions.size) return { actions: [], seeds: [] };
  const prepared = groundPreparation(options.groundPlanner)!;
  let graph = scope.graphs.get(prepared);
  // Bank selection changes action proofs, while both banks walk the same
  // immutable prepared topology and can reuse its component reachability.
  if (!graph) {
    graph = {
      topology: condenseComponents(prepared.routeBase.topology),
      walking: new Map(),
      banks: new WeakMap(),
    };
    scope.graphs.set(prepared, graph);
  }
  const { topology, walking } = graph;
  let actions = graph.banks.get(bank);
  if (!actions) {
    actions = new Map();
    for (const proof of bank.actions.values()) {
      if (
        prepared.byId.get(proof.from.id) !== proof.from ||
        prepared.byId.get(proof.to.id) !== proof.to
      )
        continue;
      const { action } = proof;
      const from = topology.components.get(action.fromSurface!),
        to = topology.components.get(action.toSurface!);
      if (from === undefined || to === undefined || from === to) continue;
      const edges = actions.get(from) ?? [];
      edges.push({ to, action });
      actions.set(from, edges);
    }
    graph.banks.set(bank, actions);
  }
  const planner = options.groundPlanner!;
  const reachable = (from: number): Set<number> => {
    let visited = walking.get(from);
    if (visited) return visited;
    visited = new Set([from]);
    const pending = [from];
    for (let index = 0; index < pending.length; index++)
      for (const to of topology.forward[pending[index]])
        if (!visited.has(to)) {
          visited.add(to);
          pending.push(to);
        }
    walking.set(from, visited);
    return visited;
  };
  const goals = new Set(
    planner
      .project(goal, {
        maxVertical: options.maxVertical,
        interaction: options.interaction,
      })
      .flatMap((hit) => {
        const component = topology.components.get(hit.surface);
        return component === undefined ? [] : [component];
      }),
  );
  const roots = starts
    .filter((start) => start.state === 'available')
    .flatMap((start) => {
      const hit = planner.project.closest(start.position, { maxVertical: options.maxVertical });
      const component = hit && topology.components.get(hit.surface);
      return component === undefined
        ? []
        : [{ component, position: start.position, elapsed: start.cost }];
    });
  if (!goals.size || !roots.length) return { actions: [], seeds: [] };
  const reachesGoal = (component: number) =>
    [...goals].some((goal) => reachable(component).has(goal));
  // This ranking estimates walking by straight horizontal distance. It guides
  // candidate ordering only; the real planner checks corridors and resource state.
  const speed = options.locomotion?.sprintSpeed ?? options.speed;
  const walkTime = (from: Vec3, to: Vec3) => Math.hypot(from[0] - to[0], from[2] - to[2]) / speed;
  const finishTime = (from: Vec3) =>
    Math.max(
      0,
      Math.hypot(from[0] - goal[0], from[2] - goal[2]) - (options.interaction?.radius ?? 0),
    ) / speed;
  type State = {
    component: number;
    position: Vec3;
    elapsed: number;
    chain: GroundConnection[];
    cost: number;
  };
  const gap = (position: Vec3) =>
    Math.hypot(position[0] - goal[0], position[1] - goal[1], position[2] - goal[2]);
  const rootGap = collectSeeds ? Math.min(...roots.map((root) => gap(root.position))) : 0;
  const prefixes = collectSeeds ? new Map<number, { state: State; gap: number }>() : undefined;
  const heap = createMinHeap<State>();
  const best = new Map<string, number>();
  const extend = (current: Omit<State, 'cost'>) => {
    if (current.chain.length >= 16) return;
    for (const component of reachable(current.component))
      for (const edge of actions.get(component) ?? []) {
        if (current.chain.some((action) => action.id === edge.action.id)) continue;
        const action = edge.action;
        const elapsed =
          current.elapsed +
          walkTime(current.position, action.points[0]) +
          action.times.at(-1)! -
          action.times[0];
        if (elapsed >= (best.get(action.id) ?? Infinity)) continue;
        best.set(action.id, elapsed);
        const position = action.points.at(-1)!;
        heap.push({
          component: edge.to,
          position,
          elapsed,
          chain: [...current.chain, action],
          cost: elapsed + finishTime(position),
        });
      }
  };
  for (const root of roots) extend({ ...root, chain: [] });
  const selected = new Map<string, GroundConnection>();
  let alternatives = 0;
  while (heap.size && selected.size < 16 && alternatives < 8) {
    const current = heap.pop()!;
    const action = current.chain.at(-1)!;
    if (current.elapsed !== best.get(action.id)) continue;
    counts.rankedStates++;
    if (reachesGoal(current.component)) {
      const additions = current.chain.filter((action) => !selected.has(action.id));
      if (additions.length && selected.size + additions.length <= 16) {
        for (const action of additions) selected.set(action.id, action);
        alternatives++;
      }
    } else if (prefixes && current.chain.length <= 8) {
      const remaining = gap(current.position);
      const previous = prefixes.get(current.component);
      if (
        remaining < rootGap &&
        (!previous ||
          remaining < previous.gap ||
          (remaining === previous.gap && current.elapsed < previous.state.elapsed))
      )
        prefixes.set(current.component, { state: current, gap: remaining });
    }
    extend(current);
  }
  if (!selected.size) {
    // These are optimistic coarse prefixes, not fresh arrivals or reachability
    // certificates. The normal root planner must check their complete action graph.
    if (prefixes) {
      const actions = new Map<string, GroundConnection>();
      let terminals = 0;
      for (const { state } of [...prefixes.values()].sort(
        (a, b) => a.gap - b.gap || a.state.elapsed - b.state.elapsed,
      )) {
        const additions = state.chain.filter((action) => !actions.has(action.id));
        if (!additions.length || actions.size + additions.length > 8) continue;
        for (const action of additions) actions.set(action.id, action);
        if (++terminals === 2) break;
      }
      if (actions.size) {
        counts.seedSelections++;
        counts.seededEdges += actions.size;
        counts.seededComponents += terminals;
        return { actions: [], seeds: [...actions.values()].map(copy) };
      }
    }
    return { actions: [], seeds: [] };
  }
  counts.candidateChains += alternatives;
  counts.selections++;
  counts.selectedEdges += selected.size;
  return { actions: [...selected.values()].map(copy), seeds: [] };
}
