import type { CollisionWorld } from '#@/src/collision.ts';
import type { Surface, Vec3 } from '#@/src/geometry.ts';
import type { Approach, Arc } from '#@/src/v1/motion/jumps.ts';
import { groundPreparation } from '#@/src/v1/route/ground.ts';
import type { DiscoveryOptions, standingFoot } from '#@/src/v1/search/traversal.ts';

type Foot = ReturnType<typeof standingFoot>;

const copyPoints = (points: Vec3[]) => points.map((point): Vec3 => [...point]);
const copyArc = (arc: Arc | null): Arc | null =>
  arc && {
    ...arc,
    ...(arc.flight ? { flight: structuredClone(arc.flight) } : {}),
    points: copyPoints(arc.points),
    times: [...arc.times],
  };
const copyApproach = (approach: Approach | null): Approach | null =>
  approach && {
    launch: [...approach.launch],
    points: copyPoints(approach.points),
    distances: [...approach.distances],
  };
const copyFoot = (foot: Foot): Foot =>
  foot.reason ? { ...foot } : { position: [...foot.position], surface: foot.surface };

function createEvidence() {
  const motions = new Map<string, Arc | null>();
  const approaches = new Map<string, Approach | null>();
  const traces = new Map<string, Vec3[] | null>();
  const feet = new Map<string, Foot>();
  return {
    standing(key: string, compute: () => Foot): Foot {
      if (!feet.has(key)) {
        if (feet.size >= 2048) feet.delete(feet.keys().next().value!);
        feet.set(key, copyFoot(compute()));
      }
      return copyFoot(feet.get(key)!);
    },
    approach(key: string, compute: () => Approach | null): Approach | null {
      if (!approaches.has(key)) {
        if (approaches.size >= 1024) approaches.delete(approaches.keys().next().value!);
        approaches.set(key, copyApproach(compute()));
      }
      return copyApproach(approaches.get(key)!);
    },
    arc(key: string, compute: () => Arc | null): Arc | null {
      if (!motions.has(key)) {
        if (motions.size >= 1024) motions.delete(motions.keys().next().value!);
        motions.set(key, copyArc(compute()));
      }
      return copyArc(motions.get(key)!);
    },
    trace(key: string, compute: () => Vec3[] | null): Vec3[] | null {
      if (!traces.has(key)) {
        if (traces.size >= 4096) traces.delete(traces.keys().next().value!);
        const points = compute();
        traces.set(key, points && copyPoints(points));
      }
      const points = traces.get(key)!;
      return points && copyPoints(points);
    },
  };
}

const worlds = new WeakMap<
  CollisionWorld,
  WeakMap<
    Surface[],
    {
      signature: string;
      portalBinding: object | string | undefined;
      evidence: ReturnType<typeof createEvidence>;
    }
  >
>();

// Evidence belongs to immutable collision/support snapshots. Query-local caches
// still own search state and logical budget charges; these maps only avoid work
// at an execution site. Copies keep returned route arrays outside the cache.
export function motionEvidence(
  world: CollisionWorld,
  surfaces: Surface[],
  signature: string,
  portalBinding?: object | string,
) {
  let snapshots = worlds.get(world);
  if (!snapshots) {
    snapshots = new WeakMap();
    worlds.set(world, snapshots);
  }
  let scope = snapshots.get(surfaces);
  if (scope?.signature !== signature || scope.portalBinding !== portalBinding) {
    scope = { signature, portalBinding, evidence: createEvidence() };
    snapshots.set(surfaces, scope);
  }
  return scope.evidence;
}

// Keep one physical binding across discovery execution sites. Query endpoints,
// reachability and budgets remain outside the reusable geometric proofs.
export function discoveryEvidence(
  world: CollisionWorld,
  surfaces: Surface[],
  options: DiscoveryOptions & { activeBoost?: string },
) {
  const ground = groundPreparation(options.groundPlanner);
  // A prepared graph owns immutable portals; standalone callers still require
  // content binding because their supplied portal arrays can be mutated.
  const portalBinding =
    ground?.surfaces === surfaces && ground.importedPortals === options.portals
      ? ground
      : JSON.stringify(options.portals);
  const signature = JSON.stringify([
    options.profile,
    options.walls,
    options.model,
    options.maxVertical,
    options.maxSlope,
    options.maxDrop,
    options.maxHorizontalDistance,
    options.sampleSpacing,
    options.activeBoost,
  ]);
  return {
    evidence: motionEvidence(world, surfaces, signature, portalBinding),
    signature,
    portalBinding,
  };
}
