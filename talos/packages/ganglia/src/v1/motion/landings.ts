import type { Vec3, Surface } from '#@/src/geometry.ts';
import type { JumpModel } from '#@/src/movement.ts';
import { type GoalProjection, closestOnSurface } from '#@/src/v1/motion/goals.ts';
import { jumpDuration } from '#@/src/v1/motion/jumps.ts';
import type { Boundary } from '#@/src/v1/search/traversal.ts';

interface Witness {
  surface: string;
  position: Vec3;
  distance?: number;
}
interface Metadata {
  center: Vec3;
  centerWitness: GoalProjection | null;
  height: number;
  edges: { a: Vec3; b: Vec3; dx: number; dz: number; squared: number }[];
}

const metadata = new WeakMap<Surface, Metadata>();
export const releaseLandingMetadata = (surface: Surface) => metadata.delete(surface);
// Surface snapshots are immutable for the lifetime of a prepared scene.
const metadataFor = (surface: Surface): Metadata => {
  let entry = metadata.get(surface);
  if (!entry) {
    const center = [0, 1, 2].map(
      (axis) =>
        surface.vertices.reduce((sum, point) => sum + point[axis], 0) / surface.vertices.length,
    ) as Vec3;
    const edges = surface.vertices.map((a, index) => {
      const b = surface.vertices[(index + 1) % surface.vertices.length];
      const dx = b[0] - a[0],
        dz = b[2] - a[2];
      return { a, b, dx, dz, squared: dx * dx + dz * dz };
    });
    entry = {
      center,
      edges,
      centerWitness: closestOnSurface(surface, center),
      height: Math.min(...surface.vertices.map((point) => point[1])),
    };
    metadata.set(surface, entry);
  }
  return entry;
};
const copyWitness = <T extends Witness>(witness: T): T => ({
  ...witness,
  position: [...witness.position],
});
/** Reuse only one query goal's nearest witness on each immutable surface.
 * Each result remains caller-owned. A changed goal bypasses this query cache,
 * including a caller mutating its original coordinate array between queries.
 */
export function createLandingGoalCache(goal: Vec3) {
  const target: Vec3 = [...goal],
    witnesses = new WeakMap<Surface, GoalProjection | null>();
  return (surface: Surface, requested = target) => {
    if (
      !Object.is(requested[0], target[0]) ||
      !Object.is(requested[1], target[1]) ||
      !Object.is(requested[2], target[2])
    )
      return closestOnSurface(surface, requested);
    let witness = witnesses.get(surface);
    if (witness === undefined) {
      witness = closestOnSurface(surface, target);
      witnesses.set(surface, witness);
    }
    return witness ? copyWitness(witness) : null;
  };
}
function* reachWitnesses(
  surface: Surface,
  start: Vec3,
  model: JumpModel,
  radius: number,
): Generator<Witness> {
  const { center, height, edges } = metadataFor(surface);
  const duration = jumpDuration(start[1], height, {
    ...model,
    mode: model.maxJumpHeight > 0 ? 'jump' : 'drop',
  });
  if (duration === null) return;
  const reach = duration * model.maxHorizontalSpeed;
  for (const { a, b, dx, dz, squared } of edges) {
    const x = a[0] - start[0],
      z = a[2] - start[2];
    if (squared === 0) continue;
    const linear = 2 * (x * dx + z * dz);
    const discriminant = linear * linear - 4 * squared * (x * x + z * z - reach * reach);
    if (discriminant < 0) continue;
    const roots = [
      (-linear - Math.sqrt(discriminant)) / (2 * squared),
      (-linear + Math.sqrt(discriminant)) / (2 * squared),
    ];
    for (const root of roots) {
      if (root < 0 || root > 1) continue;
      const middle = (roots[0] + roots[1]) / 2;
      for (const clearance of [radius / 4, radius / 2]) {
        const fraction = Math.max(
          0,
          Math.min(
            1,
            root +
              Math.sign(middle - root) *
                Math.min(Math.abs(middle - root), clearance / Math.sqrt(squared)),
          ),
        );
        const point = a.map((value, axis) => value + fraction * (b[axis] - value));
        // Inset into the convex face as well as inside the reach envelope.
        const span = Math.hypot(center[0] - point[0], center[2] - point[2]);
        const inset = span === 0 ? 0 : Math.min(1, clearance / span);
        const position = [
          point[0] + inset * (center[0] - point[0]),
          point[1] + inset * (center[1] - point[1]),
          point[2] + inset * (center[2] - point[2]),
        ] satisfies Vec3;
        yield { surface: surface.id, position };
      }
    }
  }
}
/** Sample a continuous landing region, including its intersection with the
 * optimistic horizontal flight envelope. Every witness still needs corrected
 * support, actual flight timing and a complete swept-body collision check.
 */
export function* landingCandidates(
  surface: Surface,
  start: Vec3,
  goal: Vec3,
  model: JumpModel,
  radius: number,
  goalWitness?: ReturnType<typeof createLandingGoalCache>,
): Generator<Witness> {
  const source = closestOnSurface(surface, start);
  if (source) yield source;
  const target = goalWitness ? goalWitness(surface, goal) : closestOnSurface(surface, goal);
  if (target) yield target;
  const center = metadataFor(surface).centerWitness;
  if (center) yield copyWitness(center);
  yield* reachWitnesses(surface, start, model, radius);
}
/** A body-scale inward witness on an exposed landing boundary. */
export function boundaryLanding(boundary: Boundary, reference: Vec3, inset: number): Vec3 {
  const dx = boundary.b[0] - boundary.a[0],
    dz = boundary.b[2] - boundary.a[2];
  const squared = dx * dx + dz * dz;
  const fraction =
    squared === 0
      ? 0.5
      : Math.max(
          0,
          Math.min(
            1,
            ((reference[0] - boundary.a[0]) * dx + (reference[2] - boundary.a[2]) * dz) / squared,
          ),
        );
  const point = [
    boundary.a[0] + fraction * (boundary.b[0] - boundary.a[0]),
    boundary.a[1] + fraction * (boundary.b[1] - boundary.a[1]),
    boundary.a[2] + fraction * (boundary.b[2] - boundary.a[2]),
  ] satisfies Vec3;
  point[0] += boundary.inward[0] * inset;
  point[2] += boundary.inward[1] * inset;
  return point;
}
