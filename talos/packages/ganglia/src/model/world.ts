import type { CollisionWorld } from '#@/src/collision.ts';
import type { CollisionGeometry, Surface, Vec3 } from '#@/src/geometry.ts';
import { createTypeScriptCollisionWorld } from '#@/src/model/collision.ts';
import {
  flatCuboid,
  footprintOf,
  trianglesOf,
  flatSupport,
  blockedBody,
  onBoxFace,
} from '#@/src/model/placement.ts';
import { supportBounds } from '#@/src/model/supports.ts';
import { createWallChecker } from '#@/src/model/walls.ts';
import type { FollowingSupport, PhysicalInput } from '#@/src/solver/physical.ts';

interface Configuration {
  followingSupports?: readonly FollowingSupport[];
  /** Report complete local placement proofs; the caller must require a proof
   * for every selected placement across the full snapshot set. */
  scopedPlacements?: boolean;
}

export type Coverage =
  | 'complete'
  | {
      bounds: { min: [number, number]; max: [number, number] };
      tiles: readonly { x: number; z: number }[];
      tileSpan: number;
    };
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));
const at = (a: Vec3, b: Vec3, t: number): Vec3 => a.map((v, i) => v + t * (b[i] - v)) as Vec3;
const faces = [
  [0, 4, 6, 2],
  [1, 3, 7, 5],
  [0, 1, 5, 4],
  [2, 6, 7, 3],
  [0, 2, 3, 1],
  [4, 5, 7, 6],
];

/** The provider declares complete source coverage. Sparse tile holes are not
 * inferred to be empty geometry, even inside an enclosing rectangle. */
export function createPhysicalWorld(input: PhysicalInput, coverage: Coverage) {
  if (
    coverage !== 'complete' &&
    (!Number.isFinite(coverage.tileSpan) ||
      coverage.tileSpan <= 0 ||
      coverage.bounds.min.some(
        (v, i) =>
          !Number.isFinite(v) ||
          !Number.isFinite(coverage.bounds.max[i]) ||
          v >= coverage.bounds.max[i],
      ) ||
      coverage.tiles.some(({ x, z }) => !Number.isSafeInteger(x) || !Number.isSafeInteger(z)))
  )
    throw new Error('Invalid physical coverage');
  const profile = input.ground.options.profile;
  const tiles = new Set(
    coverage === 'complete' ? [] : coverage.tiles.map(({ x, z }) => `${x},${z}`),
  );
  const covered = (a: Vec3, b: Vec3, radius = profile.radius) => {
    if (coverage === 'complete') return true;
    const low = [Math.min(a[0], b[0]) - radius, Math.min(a[2], b[2]) - radius];
    const high = [Math.max(a[0], b[0]) + radius, Math.max(a[2], b[2]) + radius];
    if (
      low.some((v, i) => v < coverage.bounds.min[i]) ||
      high.some((v, i) => v > coverage.bounds.max[i])
    )
      return false;
    for (
      let x = Math.floor(low[0] / coverage.tileSpan);
      x <= Math.floor(high[0] / coverage.tileSpan);
      x++
    )
      for (
        let z = Math.floor(low[1] / coverage.tileSpan);
        z <= Math.floor(high[1] / coverage.tileSpan);
        z++
      )
        if (!tiles.has(`${x},${z}`)) return false;
    return true;
  };
  const base = createTypeScriptCollisionWorld(input.collision);
  const blocked = createWallChecker(input.roundedWalls ?? input.ground.options.walls, profile);
  const tolerance = Math.max(0.02, (input.ground.build?.cellHeight ?? 0.1) * 3 + 0.01);
  const configured = new Map<string, ReturnType<typeof build>>();
  function build(
    placements: readonly { device: string; position: Vec3 }[],
    options: Configuration,
  ) {
    const followingSupports = options.followingSupports ?? input.devices?.followingSupports ?? [];
    const validatedPlacements: string[] = [];
    const extra: Surface[] = (input.devices?.movingSupports ?? []).flatMap((support) => {
      if (support.assumption !== 'phase-free-swept-support')
        throw new Error('Unsupported moving support assumption');
      return support.surfaces;
    });
    const solidWalls: import('#@/src/geometry.ts').Wall[] = [];
    const positions: number[] = [],
      indices: number[] = [];
    for (const support of followingSupports) {
      const supplied = placements.filter((placement) => placement.device === support.id);
      if (supplied.length > 1) throw new Error('Conflicting support placements');
      const position = supplied[0]?.position ?? support.spawn;
      if (
        (supplied.length > 0 && support.geometryKind !== 'box') ||
        support.assumption !== 'placement-within-activity-range' ||
        !position.every(Number.isFinite) ||
        distance(position, support.spawn) > support.maxDistance + 1e-6
      )
        throw new Error('Invalid support placement');
      const delta = position.map((v, i) => v - support.spawn[i]);
      const initial = distance(position, support.spawn) <= 1e-5;
      const local =
        support.bodies.every((body) => {
          const bounds = supportBounds([body.map((p) => p.map((v, i) => v + delta[i]) as Vec3)]);
          return covered(bounds.min, bounds.max, 0);
        }) &&
        (initial ||
          support.bodies.every((body) => {
            const bounds = supportBounds([body]);
            return covered(bounds.min, bounds.max, 0);
          }));
      const validate = supplied.length > 0 && (!options.scopedPlacements || local);
      for (const source of support.bodies) {
        if (!flatCuboid(source) || support.geometryKind !== 'box') {
          if (supplied.length) throw new Error('Unsupported support body');
          const bounds = supportBounds([source]);
          solidWalls.push({ ...bounds, state: 'active' });
          continue;
        }
        const body = source.map((p) => p.map((v, i) => v + delta[i]) as Vec3);
        const minimum = body[0].map((_, i) => Math.min(...body.map((p) => p[i]))) as Vec3;
        const maximum = body[0].map((_, i) => Math.max(...body.map((p) => p[i]))) as Vec3;
        solidWalls.push({ min: minimum, max: maximum, state: 'active' });
        if (validate) {
          if (!covered(minimum, maximum, 0)) throw new Error('Incomplete placement coverage');
          const selected = base.trianglesInBounds!({
            min: [minimum[0], minimum[2]],
            max: [maximum[0], maximum[2]],
          });
          const triangles = trianglesOf(input.collision, selected);
          if (!flatSupport(footprintOf(body, minimum[1]), minimum[1], triangles))
            throw new Error('Placement footprint is unsupported');
          const obstacles = initial
            ? triangles.filter((triangle) => !onBoxFace(triangle, source))
            : triangles;
          if (blockedBody({ min: minimum, max: maximum }, minimum[1], obstacles))
            throw new Error('Placed body intersects static geometry');
          if (!initial) {
            const original = supportBounds([source]);
            if (!covered(original.min, original.max, 0))
              throw new Error('Incomplete original body coverage');
            const originalTriangles = trianglesOf(
              input.collision,
              base.trianglesInBounds!({
                min: [original.min[0], original.min[2]],
                max: [original.max[0], original.max[2]],
              }),
            );
            if (blockedBody(original, original.min[1], originalTriangles))
              throw new Error('Original body collision ownership is unresolved');
          }
          for (const wall of input.roundedWalls ?? input.ground.options.walls) {
            if (
              wall.state !== 'inactive' &&
              minimum.every(
                (value, axis) => value <= wall.max[axis] && maximum[axis] >= wall.min[axis],
              )
            )
              throw new Error('Placed body intersects exclusion');
          }
          for (const other of followingSupports) {
            if (other.id === support.id) continue;
            const pick = placements.find((p) => p.device === other.id)?.position ?? other.spawn;
            const delta = pick.map((v, i) => v - other.spawn[i]);
            const bounds = supportBounds(
              other.bodies.map((points) =>
                points.map((p) => p.map((v, i) => v + delta[i]) as Vec3),
              ),
            );
            if (
              minimum.every(
                (value, axis) =>
                  Math.min(maximum[axis], bounds.max[axis]) - Math.max(value, bounds.min[axis]) >
                  1e-5,
              )
            )
              throw new Error('Placed bodies overlap');
          }
        }

        if (validate) {
          const hit = base.groundAt([position[0], minimum[1], position[2]], {
            maxUp: tolerance,
            maxDown: tolerance,
            maxSlope: input.movement.maxSlope,
          });
          if (!hit || Math.abs(hit.position[1] - minimum[1]) > tolerance)
            throw new Error('Unsupported support placement');
        }
        const center = body[0].map((_, i) => body.reduce((sum, p) => sum + p[i] / 8, 0));
        const baseIndex = positions.length / 3;
        positions.push(...body.flat());
        for (const original of faces) {
          const face = [...original];
          const [a, b, c] = face.map((i) => body[i]);
          const u = b.map((v, i) => v - a[i]),
            v = c.map((p, i) => p - a[i]);
          const normal = [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
          ];
          if (normal.reduce((sum, n, i) => sum + n * (a[i] - center[i]), 0) < 0) face.reverse();
          indices.push(
            ...[face[0], face[1], face[2], face[0], face[2], face[3]].map((i) => i + baseIndex),
          );
          const top = Math.max(...body.map((p) => p[1]));
          if (face.every((i) => Math.abs(body[i][1] - top) < 1e-6))
            extra.push({
              id: `placement/${support.id}/${baseIndex}`,
              vertices: face.map((i) => body[i]),
            });
        }
      }
      if (validate) validatedPlacements.push(support.id);
    }
    if (placements.some((p) => !followingSupports.some((s) => s.id === p.device)))
      throw new Error('Unknown support placement');
    const added = createTypeScriptCollisionWorld({ positions, indices });
    const supportGeometry: CollisionGeometry = { positions: [], indices: [] };
    const supportPositions: number[] = [],
      supportIndices: number[] = [];
    for (const surface of extra) {
      const offset = supportPositions.length / 3;
      supportPositions.push(...surface.vertices.flat());
      for (let i = 1; i + 1 < surface.vertices.length; i++)
        supportIndices.push(offset, offset + i, offset + i + 1);
    }
    supportGeometry.positions = supportPositions;
    supportGeometry.indices = supportIndices;
    const supports = createTypeScriptCollisionWorld(supportGeometry);
    const world: CollisionWorld = {
      sweepCapsule(a, b, body) {
        if (!covered(a, b, body.radius + (body.inflation ?? 0)))
          throw new Error('Incomplete swept body coverage');
        if (solidBlocked(a, b, body.inflation ?? 0)) return { triangle: -1, distance: 0 };
        return base.sweepCapsule(a, b, body) ?? added.sweepCapsule(a, b, body);
      },
      groundAt(p, options) {
        if (!covered(p, p, options.radius ?? 0)) throw new Error('Incomplete support coverage');
        const hits = [base.groundAt(p, options), supports.groundAt(p, options)];
        return (
          hits
            .filter((hit) => hit !== null)
            .sort((a, b) =>
              (options.radius ?? 0) > 0
                ? b.position[1] - a.position[1]
                : Math.abs(a.position[1] - p[1]) - Math.abs(b.position[1] - p[1]),
            )[0] ?? null
        );
      },
    };
    const continuousSupport = (a: Vec3, b: Vec3) => {
      const intervals: [number, number][] = [];
      for (const [geometry, index] of [
        [input.collision, base],
        [supportGeometry, supports],
      ] as const) {
        const candidates = index.trianglesInBounds!({
          min: [Math.min(a[0], b[0]), Math.min(a[2], b[2])],
          max: [Math.max(a[0], b[0]), Math.max(a[2], b[2])],
        });
        for (const triangle of candidates) {
          const vertices = [0, 1, 2].map((corner): Vec3 => {
            const offset = geometry.indices[triangle * 3 + corner] * 3;
            return [
              geometry.positions[offset],
              geometry.positions[offset + 1],
              geometry.positions[offset + 2],
            ];
          });
          const [p, q, r] = vertices,
            u = q.map((v, i) => v - p[i]),
            v = r.map((x, i) => x - p[i]);
          const normal = [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
          ];
          if (
            normal[1] <= 0 ||
            normal[1] / Math.hypot(...normal) < Math.cos((input.movement.maxSlope * Math.PI) / 180)
          )
            continue;
          const determinant = u[0] * v[2] - u[2] * v[0];
          if (Math.abs(determinant) < 1e-12) continue;
          const weights = (point: Vec3) => {
            const x = point[0] - p[0],
              z = point[2] - p[2];
            const b = (x * v[2] - z * v[0]) / determinant,
              c = (u[0] * z - u[2] * x) / determinant;
            return [1 - b - c, b, c];
          };
          const first = weights(a),
            last = weights(b);
          let near = 0,
            far = 1;
          const clip = (x: number, y: number) => {
            if (x < 0 && y < 0) {
              far = -1;
              return;
            }
            if (x < 0) near = Math.max(near, x / (x - y));
            if (y < 0) far = Math.min(far, x / (x - y));
          };
          for (let i = 0; i < 3; i++) clip(first[i] + 1e-9, last[i] + 1e-9);
          const offset = (point: Vec3, w: number[]) =>
            point[1] - w.reduce((sum, n, i) => sum + n * vertices[i][1], 0);
          const low = offset(a, first),
            high = offset(b, last);
          clip(tolerance - low, tolerance - high);
          clip(tolerance + low, tolerance + high);
          if (near <= far) intervals.push([near, far]);
        }
      }
      intervals.sort((a, b) => a[0] - b[0]);
      let end = 0;
      for (const [near, far] of intervals) {
        if (near > end + 1e-8) return false;
        end = Math.max(end, far);
        if (end >= 1 - 1e-8) return true;
      }
      return false;
    };
    const support = (p: Vec3) =>
      world.groundAt(p, {
        maxUp: tolerance,
        maxDown: tolerance,
        maxSlope: input.movement.maxSlope,
        radius: profile.radius,
      });
    const standing = (p: Vec3) => {
      const hit = support(p);
      if (!hit) return null;
      const clearance = p[1] - hit.position[1];
      const feet: Vec3 = [
        p[0],
        clearance >= 0.005 - 1e-6 && clearance <= 0.01 + 1e-6 ? p[1] : hit.position[1] + 0.005,
        p[2],
      ];
      return !blocked(feet, feet) &&
        !solidBlocked(feet, feet) &&
        !world.sweepCapsule(feet, feet, profile)
        ? feet
        : null;
    };
    const solidBlocked = createWallChecker(solidWalls, profile);
    const combinedBlocked = (a: Vec3, b: Vec3, inflation = 0) =>
      blocked(a, b, inflation) || solidBlocked(a, b, inflation);
    return {
      validatedPlacements,
      world,
      blocked: combinedBlocked,
      standing,
      walkTrace(a: Vec3, b: Vec3): Vec3[] | null {
        if (!continuousSupport(a, b)) return null;
        const count = Math.max(1, Math.ceil(distance(a, b) / Math.max(0.025, profile.radius / 4)));
        let previous = standing(a);
        if (!previous) return null;
        const points: Vec3[] = [previous];
        const append = (point: Vec3) => {
          if (distance(points.at(-1)!, point) <= 1e-9) return;
          while (
            points.length > 1 &&
            Math.abs(
              distance(points.at(-2)!, points.at(-1)!) +
                distance(points.at(-1)!, point) -
                distance(points.at(-2)!, point),
            ) < 1e-10
          )
            points.pop();
          points.push(point);
        };
        for (let i = 1; i <= count; i++) {
          const feet = standing(at(a, b, i / count));
          if (!feet) return null;
          if (combinedBlocked(previous, feet) || world.sweepCapsule(previous, feet, profile)) {
            const rise = feet[1] - previous[1];
            if (rise > input.movement.stepUp + 1e-6 || -rise > input.movement.stepDown + 1e-6)
              return null;
            const corner: Vec3 =
              rise > 0 ? [previous[0], feet[1], previous[2]] : [feet[0], previous[1], feet[2]];
            if (
              combinedBlocked(previous, corner) ||
              combinedBlocked(corner, feet) ||
              world.sweepCapsule(previous, corner, profile) ||
              world.sweepCapsule(corner, feet, profile)
            )
              return null;
            append(corner);
          }
          append(feet);
          previous = feet;
        }
        if (points.length === 1) points.push(points[0]);
        return points;
      },
    };
  }
  return {
    input,
    covered,
    configured(
      placements: readonly { device: string; position: Vec3 }[] = [],
      options: Configuration = {},
    ) {
      const key = JSON.stringify([placements, options]);
      let value = configured.get(key);
      if (!value) {
        value = build(placements, options);
        configured.set(key, value);
      }
      return value;
    },
  };
}
export type PhysicalWorld = ReturnType<typeof createPhysicalWorld>;
