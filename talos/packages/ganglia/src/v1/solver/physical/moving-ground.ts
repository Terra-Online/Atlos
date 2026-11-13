import type { BuildOptions } from '#@/src/build.ts';
import type { CollisionWorld } from '#@/src/collision.ts';
import type { CollisionGeometry, Portal, Surface, Vec3, Wall } from '#@/src/geometry.ts';
import { createCollisionWorld } from '#@/src/model/collision.ts';
/* oxlint-disable no-await-in-loop -- each bounded native build is completed before allocating the next */
import { createGoalProjector } from '#@/src/model/goals.ts';
import { createWallChecker } from '#@/src/model/walls.ts';
import type { GroundConnection } from '#@/src/route.ts';
import type { SweptSupport } from '#@/src/solver/physical.ts';
import { buildGroundSurfaces } from '#@/src/v1/geo/build.ts';

type Bounds = NonNullable<BuildOptions['bounds']>;
type Bake = { bounds: Bounds; height: [number, number]; roofs: number; triangles: number };
type Layer = { roofs: Surface[]; surfaces: Surface[] };

/** raw catalogue face candidates for one clearance-baked support face */
export type SourceFace = { support: number; surface: number };

// preserve native adjacency explicitly, so overlapping state meshes cannot claim base edges.
const nativePortals = (surfaces: Surface[]): Portal[] => {
  const edges = new Map<
    string,
    { surface: string; a: Vec3; b: Vec3; from: string; to: string }[]
  >();
  for (const surface of surfaces) {
    for (let edge = 0; edge < surface.vertices.length; edge++) {
      if (surface.portals && !surface.portals.includes(edge)) {
        continue;
      }
      const a = surface.vertices[edge],
        b = surface.vertices[(edge + 1) % surface.vertices.length];
      const from = JSON.stringify(a),
        to = JSON.stringify(b);
      const key = from < to ? from + '/' + to : to + '/' + from;
      const owners = edges.get(key) ?? [];
      if (!edges.has(key)) edges.set(key, owners);
      owners.push({ surface: surface.id, a, b, from, to });
    }
  }
  const portals: Portal[] = [];
  for (const owners of edges.values()) {
    if (owners.length !== 2 || owners[0].from !== owners[1].to || owners[0].to !== owners[1].from) {
      continue;
    }
    const [a, b] = owners;
    const middle: Vec3 = [(a.a[0] + a.b[0]) / 2, (a.a[1] + a.b[1]) / 2, (a.a[2] + a.b[2]) / 2];
    portals.push({
      from: a.surface,
      to: b.surface,
      points: [middle, middle],
      entry: [a.a, a.b],
      exit: [a.a, a.b],
    });
    portals.push({
      from: b.surface,
      to: a.surface,
      points: [middle, middle],
      entry: [a.a, a.b],
      exit: [a.a, a.b],
    });
  }
  return portals;
};

const geometryOf = (surfaces: Surface[]): CollisionGeometry => {
  const positions: number[] = [],
    indices: number[] = [];
  for (const surface of surfaces) {
    const base = positions.length / 3;
    positions.push(...surface.vertices.flat());
    for (let i = 1; i < surface.vertices.length - 1; i++) {
      indices.push(base, base + i, base + i + 1);
    }
  }
  return { positions, indices };
};

const centerOf = (vertices: Vec3[]): Vec3 => {
  const sum: Vec3 = [0, 0, 0];
  for (const point of vertices) {
    sum[0] += point[0];
    sum[1] += point[1];
    sum[2] += point[2];
  }
  return [sum[0] / vertices.length, sum[1] / vertices.length, sum[2] / vertices.length];
};

const boundsOf = (vertices: Vec3[], padding: number, scope: Bounds): Bounds => ({
  min: [
    Math.max(scope.min[0], Math.min(...vertices.map((p) => p[0])) - padding),
    Math.max(scope.min[1], Math.min(...vertices.map((p) => p[2])) - padding),
  ],
  max: [
    Math.min(scope.max[0], Math.max(...vertices.map((p) => p[0])) + padding),
    Math.min(scope.max[1], Math.max(...vertices.map((p) => p[2])) + padding),
  ],
});

// disjoint support footprints never cause the empty rectangle between them to be rebuilt.
const clustersOf = (surfaces: Surface[], padding: number, scope: Bounds) => {
  const entries = surfaces
    .map((surface) => ({ surface, bounds: boundsOf(surface.vertices, padding, scope) }))
    .toSorted((a, b) => a.bounds.min[0] - b.bounds.min[0]);
  const parents = entries.map((_, index) => index);
  const root = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  for (let i = 0; i < entries.length; i++) {
    for (
      let j = i + 1;
      j < entries.length && entries[j].bounds.min[0] <= entries[i].bounds.max[0];
      j++
    ) {
      if (
        entries[j].bounds.min[1] <= entries[i].bounds.max[1] &&
        entries[j].bounds.max[1] >= entries[i].bounds.min[1]
      ) {
        parents[root(j)] = root(i);
      }
    }
  }
  const clusters = new Map<number, { roofs: Surface[]; bounds: Bounds }>();
  for (let i = 0; i < entries.length; i++) {
    const { surface, bounds } = entries[i];
    const cluster = clusters.get(root(i));
    if (cluster) {
      cluster.roofs.push(surface);
      for (let axis = 0; axis < 2; axis++) {
        cluster.bounds.min[axis] = Math.min(cluster.bounds.min[axis], bounds.min[axis]);
        cluster.bounds.max[axis] = Math.max(cluster.bounds.max[axis], bounds.max[axis]);
      }
    } else {
      clusters.set(root(i), { roofs: [surface], bounds });
    }
  }
  return [...clusters.values()];
};

/**
 * @param supports build-bound phase-free device envelopes
 * @param terrain immutable static collision
 * @param world matching static collision index
 * @param options existing player ground settings, static supports and active scene exclusions
 * @returns locally clearance-baked moving supports, a support-query overlay and timed pose transfers
 * @throws on malformed envelopes or native build failure
 */
export const movingGround = async (
  supports: SweptSupport[],
  terrain: CollisionGeometry,
  world: CollisionWorld,
  {
    build,
    walls,
    surfaces: baseSurfaces,
    speed,
  }: { build: BuildOptions; walls: Wall[]; surfaces: Surface[]; speed: number },
) => {
  const bounds = build.bounds;
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error('invalid moving support join speed');
  }
  if (!bounds) {
    throw new Error('moving supports require bounded ground');
  }
  const tolerance = build.cellHeight * 3;
  const layerKey = (support: SweptSupport, height: number) =>
    support.family === 'seesaw'
      ? 'seesaw/' + support.id
      : 'height/' + Math.round(height / build.cellHeight);
  const layers = new Map<string, Layer>();
  const selected: Surface[] = [];
  const rawFaces = new Map<Surface, SourceFace>();
  for (const [supportIndex, support] of supports.entries()) {
    for (const [surfaceIndex, surface] of support.surfaces.entries()) {
      if (
        ![0, 2].every(
          (axis, i) =>
            Math.max(...surface.vertices.map((p) => p[axis])) >= bounds.min[i] &&
            Math.min(...surface.vertices.map((p) => p[axis])) <= bounds.max[i],
        )
      ) {
        continue;
      }
      selected.push(surface);
      rawFaces.set(surface, { support: supportIndex, surface: surfaceIndex });
      const key = layerKey(support, surface.vertices[0][1]);
      const layer = layers.get(key) ?? { roofs: [], surfaces: [] };
      if (!layers.has(key)) layers.set(key, layer);
      layer.roofs.push(surface);
    }
  }
  const surfaces: Surface[] = [],
    portals: Portal[] = [],
    connections: GroundConnection[] = [],
    outcomes: { id: string; reason: string }[] = [],
    builds: Bake[] = [];
  const sourceFaces = new Map<string, SourceFace[]>();
  if (!selected.length) {
    return { surfaces, portals, connections, world, outcomes, builds, sourceFaces };
  }
  const roof = geometryOf(selected);
  // callers query the static world's body-padded scope, including beyond the bake core.
  // raw roof hits still require a projection onto the clearance-baked moving surfaces.
  const supportWorld = createCollisionWorld(
    roof,
    world.bounds ? { bounds: world.bounds } : undefined,
  );
  const padding = build.profile.radius + build.cellSize * 4;
  for (const layer of layers.values()) {
    for (const cluster of clustersOf(layer.roofs, padding, bounds)) {
      // other poses of the same body are support alternatives, never headroom obstacles.
      const geometry = geometryOf(cluster.roofs);
      const positions = Array.from(geometry.positions),
        indices = Array.from(geometry.indices);
      const minimum =
        Math.min(...cluster.roofs.flatMap((s) => s.vertices.map((p) => p[1]))) -
        Math.max(build.stepUp, build.stepDown) -
        tolerance;
      const maximum =
        Math.max(...cluster.roofs.flatMap((s) => s.vertices.map((p) => p[1]))) +
        build.profile.height +
        build.stepUp +
        tolerance;
      const candidates = world.trianglesInBounds?.(cluster.bounds);
      if (!candidates) {
        throw new Error('moving support baking requires a bounded triangle index');
      }
      let triangles = 0;
      for (const triangle of candidates) {
        const vertices = [
          terrain.indices[triangle * 3],
          terrain.indices[triangle * 3 + 1],
          terrain.indices[triangle * 3 + 2],
        ];
        const heights = vertices.map((vertex) => terrain.positions[vertex * 3 + 1]);
        if (Math.max(...heights) < minimum || Math.min(...heights) > maximum) {
          continue;
        }
        triangles++;
        for (const vertex of vertices) {
          indices.push(positions.length / 3);
          positions.push(
            terrain.positions[vertex * 3],
            terrain.positions[vertex * 3 + 1],
            terrain.positions[vertex * 3 + 2],
          );
        }
      }
      builds.push({
        bounds: cluster.bounds,
        height: [minimum, maximum],
        roofs: cluster.roofs.length,
        triangles,
      });
      const baked = await buildGroundSurfaces(
        { positions, indices },
        { ...build, bounds: cluster.bounds },
      );
      const fineProject = createGoalProjector(baked),
        touching = new Set<string>();
      for (const surface of cluster.roofs) {
        for (const point of surface.vertices) {
          for (const hit of fineProject(point, {
            maxVertical: tolerance,
            interaction: { radius: build.profile.radius },
          })) {
            touching.add(hit.surface);
          }
        }
      }
      const kept: Surface[] = [];
      for (const surface of baked) {
        const center = centerOf(surface.vertices);
        const hit = supportWorld.groundAt(center, {
          maxUp: tolerance,
          maxDown: tolerance,
          maxSlope: build.maxSlope,
        });
        if (hit || touching.has(surface.id)) {
          kept.push({ ...surface, id: 'moving-ground/' + (surfaces.length + kept.length) });
        }
      }
      portals.push(...nativePortals(kept));
      for (const surface of kept) {
        const added = { ...surface, portals: [] };
        surfaces.push(added);
        layer.surfaces.push(added);
        // retain conservative candidates across native retriangulation. route
        // annotations subsequently check the actual contact against each raw face.
        const low = [0, 1, 2].map((axis) => Math.min(...surface.vertices.map((p) => p[axis])));
        const high = [0, 1, 2].map((axis) => Math.max(...surface.vertices.map((p) => p[axis])));
        sourceFaces.set(
          added.id,
          cluster.roofs
            .filter((raw) =>
              [0, 1, 2].every((axis) => {
                const margin = axis === 1 ? tolerance : 0;
                return (
                  Math.max(...raw.vertices.map((p) => p[axis])) >= low[axis] - margin &&
                  Math.min(...raw.vertices.map((p) => p[axis])) <= high[axis] + margin
                );
              }),
            )
            .map((raw) => rawFaces.get(raw)!),
        );
      }
    }
  }
  const project = createGoalProjector(surfaces),
    blocked = createWallChecker(walls, build.profile);
  const baseProject = createGoalProjector(baseSurfaces);
  for (const surface of surfaces) {
    const center = centerOf(surface.vertices);
    const destination = baseProject(center, { maxVertical: tolerance })[0];
    if (!destination) {
      continue;
    }
    const a: Vec3 = [center[0], center[1] + 0.01, center[2]],
      b: Vec3 = [destination.position[0], destination.position[1] + 0.01, destination.position[2]];
    if (blocked(a, b) || world.sweepCapsule(a, b, build.profile)) {
      continue;
    }
    const id = 'moving-join/' + surface.id;
    const duration = Math.max(
      Number.EPSILON,
      Math.hypot(...a.map((value, axis) => value - b[axis])) / speed,
    );
    connections.push({
      id,
      mode: 'rope',
      traversal: 'moving-support',
      state: 'open',
      points: [a, b],
      times: [0, duration],
      fromSurface: surface.id,
      toSurface: destination.surface,
      endpointTolerance: build.profile.radius,
    });
    connections.push({
      id: id + '/reverse',
      mode: 'rope',
      traversal: 'moving-support',
      state: 'open',
      points: [b, a],
      times: [0, duration],
      fromSurface: destination.surface,
      toSurface: surface.id,
      endpointTolerance: build.profile.radius,
    });
  }
  const projectors = new Map(
    [...layers].map(([key, layer]) => [key, createGoalProjector(layer.surfaces)]),
  );
  for (const support of supports) {
    for (const [index, transfer] of support.transfers.entries()) {
      const endpoints = [transfer.from, transfer.to].map(
        (p) =>
          projectors.get(layerKey(support, p[1]))?.(p, {
            maxVertical: tolerance,
            interaction: { radius: build.profile.radius },
          })[0],
      );
      const [from, to] = endpoints;
      if (!from || !to) {
        continue;
      }
      let reason = 'ride-speed-unresolved';
      if (transfer.speed !== null) {
        const a: Vec3 = [from.position[0], transfer.from[1] + 0.01, from.position[2]],
          b: Vec3 = [to.position[0], transfer.to[1] + 0.01, to.position[2]];
        reason = 'ride-clearance-blocked';
        if (!blocked(a, b) && !world.sweepCapsule(a, b, build.profile)) {
          const time =
            Math.hypot(...transfer.from.map((v, i) => v - transfer.to[i])) / transfer.speed;
          const id = 'moving-ride/' + support.id + '/' + index;
          connections.push({
            id,
            mode: 'rope',
            traversal: 'moving-support',
            state: 'open',
            points: [a, b],
            times: [0, time],
            fromSurface: from.surface,
            toSurface: to.surface,
            endpointTolerance: build.profile.radius,
          });
          connections.push({
            id: id + '/reverse',
            mode: 'rope',
            traversal: 'moving-support',
            state: 'open',
            points: [b, a],
            times: [0, time],
            fromSurface: to.surface,
            toSurface: from.surface,
            endpointTolerance: build.profile.radius,
          });
          reason = 'accepted';
        }
      }
      outcomes.push({ id: support.id + '/' + index, reason });
    }
  }
  const overlay: CollisionWorld = {
    get bounds() {
      return world.bounds;
    },
    get queryCacheStats() {
      return world.queryCacheStats;
    },
    trianglesInBounds: world.trianglesInBounds?.bind(world),
    sweepCapsule: world.sweepCapsule.bind(world),
    groundAt(point, options) {
      const base = world.groundAt(point, options),
        hit = supportWorld.groundAt(point, options);
      const moving = hit && { ...hit, triangle: terrain.indices.length / 3 + hit.triangle };
      if (!moving || !project(moving.position, { maxVertical: tolerance }).length) {
        return base;
      }
      if (!base) {
        return moving;
      }
      if ((options.radius ?? 0) > 0) {
        return moving.position[1] > base.position[1] ? moving : base;
      }
      return Math.abs(moving.position[1] - point[1]) < Math.abs(base.position[1] - point[1])
        ? moving
        : base;
    },
  };
  return { surfaces, portals, connections, world: overlay, outcomes, builds, sourceFaces };
};
