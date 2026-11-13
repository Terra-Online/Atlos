import {
  init,
  RecastBuildContext,
  VerticesArray,
  TrianglesArray,
  TriangleAreasArray,
  markWalkableTriangles,
} from '@recast-navigation/core';

import type { BuildOptions, TileBuildOptions, TileBuildResult } from '#@/src/build.ts';
import type { CollisionGeometry, Vec3, Surface, Portal } from '#@/src/geometry.ts';
import { createBoundsIndex } from '#@/src/model/bounds.ts';
import { clipSurface, tolerance } from '#@/src/v1/geo/clip-surface.ts';
import { buildSupportField } from '#@/src/v1/geo/support-field.ts';

type Rect = NonNullable<BuildOptions['bounds']>;
interface Settings {
  cs: number;
  ch: number;
  walkableSlopeAngle: number;
  walkableHeight: number;
  walkableRadius: number;
  walkableClimb: number;
  maxSimplificationError: number;
}
interface BoundaryEdge {
  id: string;
  a: Vec3;
  b: Vec3;
  min: number;
  max: number;
}
interface Tile {
  x: number;
  z: number;
  bounds: Rect;
  surfaces: Surface[];
}

function validateGeometry(geometry: CollisionGeometry, allowEmpty = false) {
  const { positions, indices } = geometry ?? {};
  if (
    !positions ||
    !indices ||
    positions.length % 3 ||
    indices.length % 3 ||
    (!allowEmpty && (positions.length < 9 || indices.length < 3)) ||
    (indices.length > 0 && positions.length < 9)
  )
    throw new Error('Invalid collision geometry');
  for (const value of positions)
    if (!Number.isFinite(value)) throw new Error('Non-finite collision vertex');
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= positions.length / 3)
      throw new Error('Invalid collision index');
  }
}
function validateOptions(options: BuildOptions) {
  const { profile, maxSlope, stepUp, stepDown, cellSize, cellHeight } = options ?? {};
  if (
    !profile ||
    ![profile.radius, profile.height, cellSize, cellHeight].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
    profile.height < 2 * profile.radius ||
    !Number.isFinite(maxSlope) ||
    maxSlope <= 0 ||
    maxSlope >= 90 ||
    ![stepUp, stepDown].every((value) => Number.isFinite(value) && value >= 0)
  )
    throw new Error('Invalid ground build profile');
  const height = Math.ceil(profile.height / cellHeight),
    radius = Math.ceil(profile.radius / cellSize);
  const climb = Math.max(0, Math.floor(Math.min(stepUp, stepDown) / cellHeight) - 1);
  if (height < 3 || height > 255 || radius > 255 || climb > 255)
    throw new Error('Unsupported ground build voxel profile');
}
function validateBounds(bounds: Rect) {
  if (
    !bounds ||
    !Array.isArray(bounds.min) ||
    !Array.isArray(bounds.max) ||
    bounds.min.length !== 2 ||
    bounds.max.length !== 2 ||
    ![...bounds.min, ...bounds.max].every(Number.isFinite) ||
    bounds.min.some((value, axis) => value >= bounds.max[axis])
  ) {
    throw new Error('Invalid ground build bounds');
  }
}
function clipHeight(vertices: Vec3[], low: number, high: number): Vec3[] {
  // World-grid arithmetic can place a source vertex a double-precision ulp
  // outside a boundary. The rasterizer sees Float32, so retain that same plane.
  let clipped = vertices.map((point): Vec3 => {
    for (const boundary of [low, high]) {
      if (Math.fround(point[1]) === Math.fround(boundary)) return [point[0], boundary, point[2]];
    }
    return point;
  });
  for (const [boundary, keepAbove] of [
    [low, true],
    [high, false],
  ] as const) {
    const output: Vec3[] = [];
    for (let i = 0; i < clipped.length; i++) {
      const from = clipped[i],
        to = clipped[(i + 1) % clipped.length];
      const fromInside = keepAbove ? from[1] >= boundary : from[1] <= boundary;
      const toInside = keepAbove ? to[1] >= boundary : to[1] <= boundary;
      if (fromInside) output.push(from);
      if (fromInside !== toInside) {
        const ratio = (boundary - from[1]) / (to[1] - from[1]);
        const point = [
          from[0] + ratio * (to[0] - from[0]),
          from[1] + ratio * (to[1] - from[1]),
          from[2] + ratio * (to[2] - from[2]),
        ] satisfies Vec3;
        point[1] = boundary;
        output.push(point);
      }
    }
    clipped = output;
  }
  return clipped.filter((point, index) =>
    point.some(
      (value, axis) =>
        Math.abs(value - clipped[(index + clipped.length - 1) % clipped.length][axis]) > 1e-9,
    ),
  );
}
function supportHeightRanges(vertices: number[], settings: Settings) {
  const context = new RecastBuildContext();
  const points = new VerticesArray(),
    indices = new TrianglesArray(),
    areas = new TriangleAreasArray();
  try {
    points.copy(vertices);
    indices.copy(Array.from({ length: vertices.length / 3 }, (_, index) => index));
    areas.resize(vertices.length / 9);
    markWalkableTriangles(
      context,
      settings.walkableSlopeAngle,
      points,
      points.size / 3,
      indices,
      areas.size,
      areas,
    );
    const ranges = [],
      marking = [];
    for (let i = 0; i < areas.size; i++) {
      marking.push(areas.get(i));
      if (marking[i] === 0) continue;
      const heights = [points.get(i * 9 + 1), points.get(i * 9 + 4), points.get(i * 9 + 7)];
      // Low-hanging spans may inherit the walkability of the floor below them.
      // Reserve the climb allowance and rasterization rounding around each floor.
      ranges.push([
        Math.floor(Math.min(...heights) / settings.ch) - 2,
        Math.ceil(Math.max(...heights) / settings.ch) + settings.walkableClimb + 2,
      ]);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const range of ranges) {
      if (merged.length && range[0] <= merged.at(-1)![1] + 1)
        merged.at(-1)![1] = Math.max(merged.at(-1)![1], range[1]);
      else merged.push(range);
    }
    return { ranges: merged, areas: marking };
  } finally {
    areas.destroy();
    indices.destroy();
    points.destroy();
    context.destroy();
  }
}
function buildHeightLayers(
  vertices: number[],
  min: Vec3,
  max: Vec3,
  settings: Settings,
): Surface[] {
  // Headroom and radius erosion need neighboring support even when it belongs to
  // another core. Chamfer-distance diagonals traverse two support connections,
  // so reserve two climb steps per erosion-radius cell plus boundary neighbors.
  const halo =
    settings.walkableHeight + settings.walkableClimb * (2 * settings.walkableRadius + 3) + 2;
  const coreCells = 8190 - 2 * halo;
  const first = Math.round(min[1] / settings.ch),
    last = Math.round(max[1] / settings.ch);
  if (
    coreCells <= 0 ||
    !Number.isSafeInteger(first) ||
    !Number.isSafeInteger(last) ||
    Math.ceil((last - first) / coreCells) > 512
  ) {
    throw new Error('Collision region exceeds ground build voxel limits; partition the input');
  }
  const { ranges, areas } = supportHeightRanges(vertices, settings),
    boundaries = [first];
  let start = first;
  while (last - start > coreCells) {
    let end = start + coreCells;
    const crossing = ranges.find(([low, high]) => low <= end && end <= high);
    if (crossing) end = crossing[0] - 1;
    if (end <= start || boundaries.length >= 512) {
      throw new Error(
        'Continuous support exceeds ground build vertical voxel limits; partition the input',
      );
    }
    boundaries.push(end);
    start = end;
  }
  boundaries.push(last);
  const surfaces = [];
  for (let layer = 0; layer < boundaries.length - 1; layer++) {
    const low = boundaries[layer] * settings.ch,
      high = boundaries[layer + 1] * settings.ch;
    const paddedLow = Math.max(min[1], (boundaries[layer] - halo) * settings.ch);
    const paddedHigh = Math.min(max[1], (boundaries[layer + 1] + halo) * settings.ch);
    const selected = [],
      selectedAreas = [];
    let bottom = Infinity,
      top = -Infinity;
    for (let i = 0; i < vertices.length; i += 9) {
      const triangle = [
        [vertices[i], vertices[i + 1], vertices[i + 2]] satisfies Vec3,
        [vertices[i + 3], vertices[i + 4], vertices[i + 5]] satisfies Vec3,
        [vertices[i + 6], vertices[i + 7], vertices[i + 8]] satisfies Vec3,
      ];
      if (
        triangle.every((point) => Math.fround(point[1]) < Math.fround(paddedLow)) ||
        triangle.every((point) => Math.fround(point[1]) > Math.fround(paddedHigh))
      )
        continue;
      // Clip solids without adding caps. A tall wall must remain a wall, while
      // its off-slab vertices cannot overflow Recast's compact span height.
      const clipped = clipHeight(triangle, paddedLow, paddedHigh);
      for (let corner = 1; corner < clipped.length - 1; corner++) {
        selected.push(...clipped[0], ...clipped[corner], ...clipped[corner + 1]);
        selectedAreas.push(areas[i / 9]);
        for (const point of [clipped[0], clipped[corner], clipped[corner + 1]]) {
          bottom = Math.min(bottom, point[1]);
          top = Math.max(top, point[1]);
        }
      }
    }
    if (!selected.length) continue;
    // Empty vertical padding is unnecessary once every intersecting solid has
    // been retained. Keep the native origin close to its actual input heights.
    const nativeLow =
      Math.max(Math.round(paddedLow / settings.ch), Math.floor(bottom / settings.ch)) * settings.ch;
    const nativeHigh =
      Math.min(Math.round(paddedHigh / settings.ch), Math.ceil(top / settings.ch)) * settings.ch;
    const built = buildSupportField(
      selected,
      [
        [min[0], nativeLow, min[2]],
        [max[0], nativeHigh, max[2]],
      ],
      settings,
      selectedAreas,
    );
    for (const surface of built!) {
      const bottom = Math.min(...surface.vertices.map((point) => point[1]));
      const top = Math.max(...surface.vertices.map((point) => point[1]));
      // Independently simplified detail meshes do not share an exact contour at
      // arbitrary height cuts. Only empty support gaps may separate the cores.
      if (
        (layer > 0 && bottom <= low && top >= low) ||
        (layer < boundaries.length - 2 && bottom <= high && top >= high)
      ) {
        throw new Error('Vertical ground partition intersects support; partition the input');
      }
      if ((layer > 0 && top < low) || (layer < boundaries.length - 2 && bottom > high)) continue;
      surfaces.push({ ...surface, id: String(surfaces.length) });
    }
  }
  return surfaces;
}
/** Build player ground surfaces from selected world-space collision triangles.
 * Normals must point out of solids (up for floors). Include ceilings and obstacles,
 * not just floor triangles. This offline entry point does not load through the
 * runtime package root. Returned detail triangles retain sampled ground heights.
 *
 * The importer owns scene/state selection, collision layers, hazards and completeness.
 * Recast approximates a cylinder in a voxel field; its mesh is not a capsule-sweep
 * proof. Ordinary links use the smaller step limit in both directions. Drops and
 * jumps need separately validated directed connections, never automatic gap links.
 */
export async function buildGroundSurfaces(
  geometry: CollisionGeometry,
  options: BuildOptions,
): Promise<Surface[]> {
  validateGeometry(geometry);
  validateOptions(options);
  const { positions, indices } = geometry;
  const { profile, maxSlope, stepUp, stepDown, cellSize, cellHeight } = options;
  const min: Vec3 = [Infinity, Infinity, Infinity],
    max: Vec3 = [-Infinity, -Infinity, -Infinity];
  // Expand selected indexed collision to a triangle soup for the native rasterizer.
  const vertices = [];
  for (const i of indices) {
    for (let axis = 0; axis < 3; axis++) {
      const v = positions[i * 3 + axis];
      vertices.push(v);
      min[axis] = Math.min(min[axis], v);
      max[axis] = Math.max(max[axis], v);
    }
  }
  // Streamed actors may extend far outside the requested region. Clip the voxel
  // build in XZ, while retaining every input's vertical extent for headroom.
  if (options.bounds !== undefined) {
    const b = options.bounds;
    validateBounds(b);
    min[0] = b.min[0];
    min[2] = b.min[1];
    max[0] = b.max[0];
    max[2] = b.max[1];
  }
  // Independent tiles must share the same vertical voxel grid, including when
  // their cropped geometry has different lowest vertices.
  min[1] = Math.floor(min[1] / cellHeight) * cellHeight;
  max[1] = Math.ceil(max[1] / cellHeight) * cellHeight;
  const width = Math.ceil((max[0] - min[0]) / cellSize);
  const depth = Math.ceil((max[2] - min[2]) / cellSize);
  if (width < 1 || depth < 1 || width * depth > 8000000) {
    throw new Error('Collision region exceeds ground build voxel limits; partition the input');
  }
  const height = Math.ceil(profile.height / cellHeight),
    radius = Math.ceil(profile.radius / cellSize);
  const climb = Math.max(0, Math.floor(Math.min(stepUp, stepDown) / cellHeight) - 1);
  await init();
  const settings = {
    cs: cellSize,
    ch: cellHeight,
    walkableSlopeAngle: maxSlope,
    walkableHeight: height,
    walkableRadius: radius,
    // Reserve one vertical voxel for rasterization error. The larger downward
    // allowance must not accidentally authorize the same climb in reverse.
    walkableClimb: climb,
    maxSimplificationError: 0.5,
  };
  if ((max[1] - min[1]) / cellHeight > 8190) return buildHeightLayers(vertices, min, max, settings);
  return buildSupportField(vertices, [min, max], settings);
}
function boundaryEdges(surfaces: Surface[], axis: 0 | 2, boundary: number): BoundaryEdge[] {
  const other = axis === 0 ? 2 : 0,
    edges = [];
  for (const surface of surfaces) {
    for (let i = 0; i < surface.vertices.length; i++) {
      const a = surface.vertices[i],
        b = surface.vertices[(i + 1) % surface.vertices.length];
      if (
        Math.abs(a[axis] - boundary) > tolerance ||
        Math.abs(b[axis] - boundary) > tolerance ||
        Math.abs(a[other] - b[other]) <= tolerance
      )
        continue;
      edges.push({
        id: surface.id,
        a,
        b,
        min: Math.min(a[other], b[other]),
        max: Math.max(a[other], b[other]),
      });
    }
  }
  return edges.sort((a, b) => a.min - b.min);
}
function joinTiles(from: Tile, to: Tile, axis: 0 | 2, options: BuildOptions): Portal[] {
  const boundary = from.bounds.max[axis === 0 ? 0 : 1],
    other = axis === 0 ? 2 : 0;
  const a = boundaryEdges(from.surfaces, axis, boundary),
    b = boundaryEdges(to.surfaces, axis, boundary);
  const portals: Portal[] = [];
  let first = 0;
  const pointAt = (edge: BoundaryEdge, position: number): Vec3 => {
    const ratio = (position - edge.a[other]) / (edge.b[other] - edge.a[other]);
    const point = [
      edge.a[0] + ratio * (edge.b[0] - edge.a[0]),
      edge.a[1] + ratio * (edge.b[1] - edge.a[1]),
      edge.a[2] + ratio * (edge.b[2] - edge.a[2]),
    ] satisfies Vec3;
    point[axis] = boundary;
    point[other] = position;
    return point;
  };
  const connect = (from: BoundaryEdge, to: BoundaryEdge, near: number, far: number) => {
    const rise = pointAt(to, near)[1] - pointAt(from, near)[1];
    const delta = pointAt(to, far)[1] - pointAt(from, far)[1] - rise;
    let low = 0,
      high = 1;
    if (Math.abs(delta) <= 1e-12) {
      if (rise > options.stepUp + tolerance || -rise > options.stepDown + tolerance) return;
    } else {
      const first = (-options.stepDown - rise) / delta,
        last = (options.stepUp - rise) / delta;
      low = Math.max(0, Math.min(first, last));
      high = Math.min(1, Math.max(first, last));
    }
    const start = near + low * (far - near),
      end = near + high * (far - near);
    if (end - start <= tolerance) return;
    const entry: [Vec3, Vec3] = [pointAt(from, start), pointAt(from, end)];
    const exit: [Vec3, Vec3] = [pointAt(to, start), pointAt(to, end)];
    portals.push({
      from: from.id,
      to: to.id,
      entry,
      exit,
      points: [pointAt(from, (start + end) / 2), pointAt(to, (start + end) / 2)],
    });
  };
  for (const edge of a) {
    while (first < b.length && b[first].max <= edge.min + tolerance) first++;
    for (let i = first; i < b.length && b[i].min < edge.max - tolerance; i++) {
      const near = Math.max(edge.min, b[i].min),
        far = Math.min(edge.max, b[i].max);
      if (far - near <= tolerance) continue;
      connect(edge, b[i], near, far);
      connect(b[i], edge, near, far);
    }
  }
  return portals;
}
/** Offline padded builds on one world-space voxel grid. Core clipping removes
 * artificial clearance erosion at tile boundaries. Only overlapping edges on
 * neighboring core boundaries receive directed, step-limited seam transfers.
 * Complete collision geometry and the same state/profile must cover every pad.
 */
export async function buildGroundTiles(
  geometry: CollisionGeometry,
  options: TileBuildOptions,
): Promise<TileBuildResult> {
  validateGeometry(geometry, true);
  validateOptions(options);
  validateBounds(options.bounds);
  const { bounds, cellSize, tileCells } = options;
  if (!Number.isSafeInteger(tileCells) || tileCells < 1)
    throw new Error('Invalid ground tile cell count');
  const size = tileCells * cellSize;
  if (!Number.isFinite(size)) throw new Error('Invalid ground tile size');
  const gridIndex = (value: number, round: (value: number) => number) => {
    const coordinate = value / size,
      nearest = Math.round(coordinate);
    return Math.abs(value - nearest * size) <= tolerance ? nearest : round(coordinate);
  };
  const minX = gridIndex(bounds.min[0], Math.floor),
    maxX = gridIndex(bounds.max[0], Math.ceil);
  const minZ = gridIndex(bounds.min[1], Math.floor),
    maxZ = gridIndex(bounds.max[1], Math.ceil);
  const count = (maxX - minX) * (maxZ - minZ);
  const selected = options.tiles;
  if (
    ![minX, maxX, minZ, maxZ].every(Number.isSafeInteger) ||
    count < 1 ||
    (selected === undefined
      ? count > 512
      : !Array.isArray(selected) || !selected.length || selected.length > 512)
  ) {
    throw new Error('Ground build exceeds the 512 tile limit');
  }
  const coordinates = [],
    seen = new Set<string>();
  if (selected !== undefined) {
    for (const tile of selected) {
      if (
        !tile ||
        !Number.isSafeInteger(tile.x) ||
        !Number.isSafeInteger(tile.z) ||
        tile.x < minX ||
        tile.x >= maxX ||
        tile.z < minZ ||
        tile.z >= maxZ ||
        seen.has(`${tile.x},${tile.z}`)
      ) {
        throw new Error('Invalid ground tile selection');
      }
      seen.add(`${tile.x},${tile.z}`);
      coordinates.push({ x: tile.x, z: tile.z });
    }
    coordinates.sort((a, b) => a.z - b.z || a.x - b.x);
  } else {
    for (let z = minZ; z < maxZ; z++) for (let x = minX; x < maxX; x++) coordinates.push({ x, z });
  }
  const padding = (Math.ceil(options.profile.radius / cellSize) + 3) * cellSize;
  const patches = coordinates.map(({ x, z }) => {
    const padded: Rect = {
      min: [x * size - padding, z * size - padding],
      max: [(x + 1) * size + padding, (z + 1) * size + padding],
    };
    const triangles: number[][] = [];
    return {
      x,
      z,
      padded,
      triangles,
      min: [padded.min[0], 0, padded.min[1]],
      max: [padded.max[0], 0, padded.max[1]],
    };
  });
  // Assign each input triangle to its inclusive padded tile bounds once. Input
  // order within a tile remains unchanged, including boundary-only contacts.
  const queryTiles = createBoundsIndex(patches);
  const { positions, indices } = geometry;
  const extent = {
    min: [minX * size - padding, minZ * size - padding],
    max: [maxX * size + padding, maxZ * size + padding],
  };
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3,
      b = indices[i + 1] * 3,
      c = indices[i + 2] * 3;
    const left = Math.min(positions[a], positions[b], positions[c]);
    const right = Math.max(positions[a], positions[b], positions[c]);
    const near = Math.min(positions[a + 2], positions[b + 2], positions[c + 2]);
    const far = Math.max(positions[a + 2], positions[b + 2], positions[c + 2]);
    // Streamed collision batches can contain millions of distant triangles.
    // Reject their packed bounds before allocating any per-triangle objects.
    if (
      left > extent.max[0] ||
      right < extent.min[0] ||
      near > extent.max[1] ||
      far < extent.min[1]
    )
      continue;
    let vertices: number[] | undefined;
    for (const tile of queryTiles({ min: [left, 0, near], max: [right, 0, far] })) {
      vertices ??= [
        positions[a],
        positions[a + 1],
        positions[a + 2],
        positions[b],
        positions[b + 1],
        positions[b + 2],
        positions[c],
        positions[c + 1],
        positions[c + 2],
      ];
      tile.triangles.push(vertices);
    }
  }
  const tiles = [],
    surfaces: Surface[] = [],
    portals = [],
    byPosition = new Map<string, Tile>();
  for (const { x, z, padded, triangles } of patches) {
    const started = performance.now();
    let cached = false;
    const core: Rect = {
      min: [Math.max(bounds.min[0], x * size), Math.max(bounds.min[1], z * size)],
      max: [Math.min(bounds.max[0], (x + 1) * size), Math.min(bounds.max[1], (z + 1) * size)],
    };
    const vertices: number[] = [];
    for (const triangle of triangles) vertices.push(...triangle);
    triangles.length = 0;
    const tile: Tile = { x, z, bounds: core, surfaces: [] };
    if (vertices.length) {
      let built;
      try {
        const geometry = {
          positions: vertices,
          indices: Array.from({ length: vertices.length / 3 }, (_, index) => index),
        };
        const settings = {
          profile: options.profile,
          maxSlope: options.maxSlope,
          stepUp: options.stepUp,
          stepDown: options.stepDown,
          cellSize: options.cellSize,
          cellHeight: options.cellHeight,
          bounds: padded,
        };
        built = await options.cache?.load(geometry, settings);
        cached = built !== null && built !== undefined;
        if (!cached) {
          built = await buildGroundSurfaces(geometry, settings);
          await options.cache?.save(geometry, settings, built);
        }
      } catch (cause) {
        throw new Error(
          `Ground tile (${x}, ${z}) build failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          { cause },
        );
      }
      for (const surface of built!) {
        const clipped = clipSurface(surface.vertices, core);
        if (clipped) tile.surfaces.push({ id: `${x},${z}/${surface.id}`, vertices: clipped });
      }
    }
    tiles.push({ x, z, bounds: core, surfaces: tile.surfaces.length });
    options.onTile?.({
      x,
      z,
      completed: tiles.length,
      total: coordinates.length,
      surfaces: tile.surfaces.length,
      cached,
      elapsedMs: performance.now() - started,
    });
    surfaces.push(...tile.surfaces);
    byPosition.set(`${x},${z}`, tile);
    for (const [neighborX, neighborZ, axis] of [
      [x - 1, z, 0],
      [x, z - 1, 2],
    ] as const) {
      const neighbor = byPosition.get(`${neighborX},${neighborZ}`);
      if (neighbor) portals.push(...joinTiles(neighbor, tile, axis, options));
    }
  }
  return { surfaces, portals, tiles };
}
