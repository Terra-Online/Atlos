import type { Capsule, CollisionOptions, CollisionWorld } from '#@/src/collision.ts';
import type { CollisionGeometry, Vec3 } from '#@/src/geometry.ts';
import { createTypeScriptCollisionWorld } from '#@/src/model/collision.ts';

type GroundHit = ReturnType<CollisionWorld['groundAt']>;
type SweepHit = ReturnType<CollisionWorld['sweepCapsule']>;

export interface CollisionTile {
  /** Stable identifier for LRU caching and diagnostics (e.g. "map01:3,-2"). */
  key: string;
  /** Inclusive XZ coverage rectangle of this tile in world metres. */
  bounds: { min: [number, number]; max: [number, number] };
  /** Pre-built tile CollisionWorld. Should be built without a strict per-tile
   * scope guard so queries crossing tile seams do not throw; the composite
   * MultiTileCollisionWorld enforces the overall window XZ scope.
   */
  world: CollisionWorld;
  /** Optional offset added to triangle IDs returned by this tile (default 0). */
  triangleOffset?: number;
  /** Approximate resident byte footprint for byte-bounded LRU accounting. */
  estimatedBytes?: number;
}

export interface MultiTileCollisionOptions {
  /** Inclusive overall XZ window scope. Queries whose full footprint extends
   * outside this rectangle throw identically to createCollisionWorld.
   */
  bounds?: CollisionOptions['bounds'];
  /** Deduplicate triangle IDs in trianglesInBounds when tiles retain shared
   * seam-crossing triangles with original scene-wide IDs (default true).
   */
  deduplicateTriangles?: boolean;
}

const finitePoint = (p: unknown): p is Vec3 =>
  Array.isArray(p) &&
  p.length === 3 &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]) &&
  Number.isFinite(p[2]);

/** Estimate resident typed-array byte footprint for a flat collision BVH.
 * Matches collision.ts layout: ~143 bytes/tri (triVerts 72 + triBounds 48 +
 * triIds 4 + amortized flat BVH node arrays ~19). */
export const estimateTileCollisionBytes = (triangleCount: number): number =>
  Math.max(1024, Math.ceil(triangleCount * 144));

/** Build a single tile's flat BVH from triangles overlapping `tileBounds`.
 * Triangles are indexed without a per-tile throwing scope guard so queries
 * straddling adjacent tile seams can query every overlapping tile seamlessly.
 * Returned `originalIds` mapping preserves original source triangle IDs if
 * `preserveOriginalIds` is true; otherwise uses dense tile-local IDs.
 */
export function buildCollisionTile(
  key: string,
  geometry: CollisionGeometry,
  tileBounds: { min: [number, number]; max: [number, number] },
): CollisionTile {
  const { positions, indices } = geometry;
  if (!positions || !indices || positions.length % 3 || indices.length % 3) {
    throw new Error('Invalid collision geometry');
  }
  const minX = tileBounds.min[0];
  const minZ = tileBounds.min[1];
  const maxX = tileBounds.max[0];
  const maxZ = tileBounds.max[1];
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minZ) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxZ) ||
    minX > maxX ||
    minZ > maxZ
  ) {
    throw new Error('Invalid collision tile XZ bounds');
  }
  // Extract only triangles whose XZ AABB overlaps the tile rectangle and remap
  // vertices densely so each tile owns a compact standalone CollisionWorld.
  const keptTris: number[] = [];
  for (let offset = 0; offset < indices.length; offset += 3) {
    const ia = indices[offset] * 3;
    const ib = indices[offset + 1] * 3;
    const ic = indices[offset + 2] * 3;
    const x0 = positions[ia],
      x1 = positions[ib],
      x2 = positions[ic];
    const z0 = positions[ia + 2],
      z1 = positions[ib + 2],
      z2 = positions[ic + 2];
    const tMinX = x0 < x1 ? (x0 < x2 ? x0 : x2) : x1 < x2 ? x1 : x2;
    const tMaxX = x0 > x1 ? (x0 > x2 ? x0 : x2) : x1 > x2 ? x1 : x2;
    const tMinZ = z0 < z1 ? (z0 < z2 ? z0 : z2) : z1 < z2 ? z1 : z2;
    const tMaxZ = z0 > z1 ? (z0 > z2 ? z0 : z2) : z1 > z2 ? z1 : z2;
    if (tMaxX >= minX && tMinX <= maxX && tMaxZ >= minZ && tMinZ <= maxZ) {
      keptTris.push(offset / 3);
    }
  }
  const vertexRemap = new Map<number, number>();
  const tilePositions: number[] = [];
  const tileIndices = new Uint32Array(keptTris.length * 3);
  const originalTriIds = new Uint32Array(keptTris.length);
  for (let i = 0; i < keptTris.length; i++) {
    const origTri = keptTris[i];
    originalTriIds[i] = origTri;
    for (let corner = 0; corner < 3; corner++) {
      const origVert = indices[origTri * 3 + corner];
      let localVert = vertexRemap.get(origVert);
      if (localVert === undefined) {
        localVert = tilePositions.length / 3;
        vertexRemap.set(origVert, localVert);
        const pOff = origVert * 3;
        tilePositions.push(positions[pOff], positions[pOff + 1], positions[pOff + 2]);
      }
      tileIndices[i * 3 + corner] = localVert;
    }
  }
  const rawWorld = createTypeScriptCollisionWorld({
    positions: Float64Array.from(tilePositions),
    indices: tileIndices,
  });
  // Wrap to remap local triangle IDs back to original source triangle IDs.
  const world: CollisionWorld = {
    bounds: null,
    get queryCacheStats() {
      return rawWorld.queryCacheStats;
    },
    trianglesInBounds(rect) {
      const local = rawWorld.trianglesInBounds!(rect);
      for (let i = 0; i < local.length; i++) local[i] = originalTriIds[local[i]];
      return local.sort((a, b) => a - b);
    },
    groundAt(position, options) {
      const hit = rawWorld.groundAt(position, options);
      if (!hit) return null;
      return {
        position: hit.position,
        triangle: originalTriIds[hit.triangle],
        normal: hit.normal,
      };
    },
    sweepCapsule(start, end, profile) {
      const hit = rawWorld.sweepCapsule(start, end, profile);
      if (!hit) return null;
      return {
        triangle: originalTriIds[hit.triangle],
        distance: hit.distance,
      };
    },
    hasTrianglesInAabb: rawWorld.hasTrianglesInAabb,
    probeSphere: rawWorld.probeSphere,
  };
  return {
    key,
    bounds: { min: [minX, minZ], max: [maxX, maxZ] },
    world,
    estimatedBytes: estimateTileCollisionBytes(keptTris.length),
  };
}

/** Composite CollisionWorld that queries active per-tile flat BVHs directly
 * without merging triangle buffers or rebuilding a combined window BVH.
 * Designed for sliding, expanded, and bisected route windows backed by an
 * in-memory per-tile BVH LRU cache.
 */
export function createMultiTileCollisionWorld(
  tiles: readonly CollisionTile[],
  options?: MultiTileCollisionOptions,
): CollisionWorld {
  let hasScope = false;
  let scopeMinX = 0,
    scopeMinZ = 0,
    scopeMaxX = 0,
    scopeMaxZ = 0;
  if (options?.bounds !== undefined) {
    const requested = options.bounds;
    if (
      !requested ||
      !Array.isArray(requested.min) ||
      !Array.isArray(requested.max) ||
      requested.min.length !== 2 ||
      requested.max.length !== 2 ||
      !Number.isFinite(requested.min[0]) ||
      !Number.isFinite(requested.min[1]) ||
      !Number.isFinite(requested.max[0]) ||
      !Number.isFinite(requested.max[1]) ||
      requested.min[0] > requested.max[0] ||
      requested.min[1] > requested.max[1]
    ) {
      throw new Error('Invalid collision XZ bounds');
    }
    scopeMinX = requested.min[0];
    scopeMinZ = requested.min[1];
    scopeMaxX = requested.max[0];
    scopeMaxZ = requested.max[1];
    hasScope = true;
  }

  const tileCount = tiles.length;
  const tileBounds = new Float64Array(tileCount * 4);
  const tileWorlds = new Array<CollisionWorld>(tileCount);
  const tileOffsets = new Int32Array(tileCount);
  let allHaveAabb = true;
  let allHaveProbe = true;
  for (let i = 0; i < tileCount; i++) {
    const tile = tiles[i];
    const b = tile.bounds;
    if (
      !b ||
      !Number.isFinite(b.min[0]) ||
      !Number.isFinite(b.min[1]) ||
      !Number.isFinite(b.max[0]) ||
      !Number.isFinite(b.max[1]) ||
      b.min[0] > b.max[0] ||
      b.min[1] > b.max[1]
    ) {
      throw new Error(`Invalid tile bounds for ${tile.key}`);
    }
    tileBounds[i * 4] = b.min[0];
    tileBounds[i * 4 + 1] = b.min[1];
    tileBounds[i * 4 + 2] = b.max[0];
    tileBounds[i * 4 + 3] = b.max[1];
    tileWorlds[i] = tile.world;
    tileOffsets[i] = tile.triangleOffset ?? 0;
    if (!tile.world.hasTrianglesInAabb) allHaveAabb = false;
    if (!tile.world.probeSphere) allHaveProbe = false;
  }

  const deduplicate = options?.deduplicateTriangles ?? true;
  const requireScope = (minX: number, minZ: number, maxX: number, maxZ: number) => {
    if (
      hasScope &&
      (minX < scopeMinX || minZ < scopeMinZ || maxX > scopeMaxX || maxZ > scopeMaxZ)
    ) {
      throw new Error('Collision query exceeds indexed XZ bounds');
    }
  };

  return {
    bounds: hasScope ? { min: [scopeMinX, scopeMinZ], max: [scopeMaxX, scopeMaxZ] } : null,
    get queryCacheStats() {
      return { capacity: 0, entries: 0, hits: 0, misses: 0 };
    },
    trianglesInBounds(rectangle) {
      if (
        !rectangle ||
        !Array.isArray(rectangle.min) ||
        !Array.isArray(rectangle.max) ||
        rectangle.min.length !== 2 ||
        rectangle.max.length !== 2 ||
        !Number.isFinite(rectangle.min[0]) ||
        !Number.isFinite(rectangle.min[1]) ||
        !Number.isFinite(rectangle.max[0]) ||
        !Number.isFinite(rectangle.max[1]) ||
        rectangle.min[0] > rectangle.max[0] ||
        rectangle.min[1] > rectangle.max[1]
      ) {
        throw new Error('Invalid collision triangle rectangle');
      }
      const qMinX = rectangle.min[0],
        qMinZ = rectangle.min[1];
      const qMaxX = rectangle.max[0],
        qMaxZ = rectangle.max[1];
      requireScope(qMinX, qMinZ, qMaxX, qMaxZ);
      const out: number[] = [];
      for (let i = 0; i < tileCount; i++) {
        const off = i * 4;
        if (
          qMinX > tileBounds[off + 2] ||
          qMaxX < tileBounds[off] ||
          qMinZ > tileBounds[off + 3] ||
          qMaxZ < tileBounds[off + 1]
        ) {
          continue;
        }
        const ids = tileWorlds[i].trianglesInBounds?.(rectangle);
        if (!ids) continue;
        const delta = tileOffsets[i];
        for (let j = 0; j < ids.length; j++) out.push(ids[j] + delta);
      }
      out.sort((a, b) => a - b);
      if (deduplicate && out.length > 1) {
        let write = 1;
        for (let read = 1; read < out.length; read++) {
          if (out[read] !== out[write - 1]) out[write++] = out[read];
        }
        out.length = write;
      }
      return out;
    },
    groundAt(position: Vec3, queryOptions: Parameters<CollisionWorld['groundAt']>[1]): GroundHit {
      const { maxUp, maxDown, maxSlope, radius = 0 } = queryOptions ?? {};
      if (
        !finitePoint(position) ||
        !Number.isFinite(maxUp) ||
        !Number.isFinite(maxDown) ||
        !Number.isFinite(maxSlope) ||
        !Number.isFinite(radius) ||
        maxUp < 0 ||
        maxDown < 0 ||
        maxSlope <= 0 ||
        maxSlope >= 90 ||
        radius < 0
      ) {
        throw new Error('Invalid ground support query');
      }
      const px = position[0],
        py = position[1],
        pz = position[2];
      const qMinX = px - radius,
        qMinY = py - maxDown - radius,
        qMinZ = pz - radius;
      const qMaxX = px + radius,
        qMaxY = py + maxUp + radius,
        qMaxZ = pz + radius;
      if (
        !Number.isFinite(qMinX) ||
        !Number.isFinite(qMinY) ||
        !Number.isFinite(qMinZ) ||
        !Number.isFinite(qMaxX) ||
        !Number.isFinite(qMaxY) ||
        !Number.isFinite(qMaxZ)
      ) {
        throw new Error('Non-finite ground support bounds');
      }
      requireScope(qMinX, qMinZ, qMaxX, qMaxZ);
      let best: GroundHit = null;
      let bestOffset = Infinity;
      for (let i = 0; i < tileCount; i++) {
        const off = i * 4;
        if (
          qMinX > tileBounds[off + 2] ||
          qMaxX < tileBounds[off] ||
          qMinZ > tileBounds[off + 3] ||
          qMaxZ < tileBounds[off + 1]
        ) {
          continue;
        }
        const hit = tileWorlds[i].groundAt(position, queryOptions);
        if (!hit) continue;
        const height = hit.position[1];
        const offset = Math.abs(height - py);
        if (
          (radius > 0 && (!best || height > best.position[1])) ||
          (radius === 0 &&
            (offset < bestOffset || (offset === bestOffset && height > best!.position[1])))
        ) {
          bestOffset = offset;
          best =
            tileOffsets[i] !== 0
              ? {
                  position: hit.position,
                  triangle: hit.triangle + tileOffsets[i],
                  normal: hit.normal,
                }
              : hit;
        }
      }
      return best;
    },
    sweepCapsule(start: Vec3, end: Vec3, profile: Capsule): SweepHit {
      const { radius, height, inflation = 0 } = profile ?? {};
      if (
        !finitePoint(start) ||
        !finitePoint(end) ||
        !Number.isFinite(radius) ||
        !Number.isFinite(height) ||
        !Number.isFinite(inflation) ||
        radius < 0 ||
        height <= 0 ||
        height < 2 * radius ||
        inflation < 0
      ) {
        throw new Error('Invalid capsule sweep');
      }
      const r = radius + inflation;
      const sx = start[0],
        sy = start[1],
        sz = start[2];
      const ex = end[0],
        ey = end[1],
        ez = end[2];
      const qMinX = (sx < ex ? sx : ex) - r;
      const qMinY = (sy < ey ? sy : ey) - inflation;
      const qMinZ = (sz < ez ? sz : ez) - r;
      const qMaxX = (sx > ex ? sx : ex) + r;
      const qMaxY = (sy > ey ? sy : ey) + height + inflation;
      const qMaxZ = (sz > ez ? sz : ez) + r;
      if (
        !Number.isFinite(qMinX) ||
        !Number.isFinite(qMinY) ||
        !Number.isFinite(qMinZ) ||
        !Number.isFinite(qMaxX) ||
        !Number.isFinite(qMaxY) ||
        !Number.isFinite(qMaxZ)
      ) {
        throw new Error('Non-finite capsule bounds');
      }
      requireScope(qMinX, qMinZ, qMaxX, qMaxZ);
      for (let i = 0; i < tileCount; i++) {
        const off = i * 4;
        if (
          qMinX > tileBounds[off + 2] ||
          qMaxX < tileBounds[off] ||
          qMinZ > tileBounds[off + 3] ||
          qMaxZ < tileBounds[off + 1]
        ) {
          continue;
        }
        const hit = tileWorlds[i].sweepCapsule(start, end, profile);
        if (hit) {
          return tileOffsets[i] !== 0
            ? { triangle: hit.triangle + tileOffsets[i], distance: hit.distance }
            : hit;
        }
      }
      return null;
    },
    ...(allHaveAabb
      ? {
          hasTrianglesInAabb(
            qMinX: number,
            qMinY: number,
            qMinZ: number,
            qMaxX: number,
            qMaxY: number,
            qMaxZ: number,
          ): boolean {
            requireScope(qMinX, qMinZ, qMaxX, qMaxZ);
            for (let i = 0; i < tileCount; i++) {
              const off = i * 4;
              if (
                qMinX > tileBounds[off + 2] ||
                qMaxX < tileBounds[off] ||
                qMinZ > tileBounds[off + 3] ||
                qMaxZ < tileBounds[off + 1]
              ) {
                continue;
              }
              if (tileWorlds[i].hasTrianglesInAabb!(qMinX, qMinY, qMinZ, qMaxX, qMaxY, qMaxZ)) {
                return true;
              }
            }
            return false;
          },
        }
      : {}),
    ...(allHaveProbe
      ? {
          probeSphere(center: Vec3, radius: number): boolean {
            const px = center[0],
              pz = center[2];
            const qMinX = px - radius,
              qMinZ = pz - radius;
            const qMaxX = px + radius,
              qMaxZ = pz + radius;
            requireScope(qMinX, qMinZ, qMaxX, qMaxZ);
            for (let i = 0; i < tileCount; i++) {
              const off = i * 4;
              if (
                qMinX > tileBounds[off + 2] ||
                qMaxX < tileBounds[off] ||
                qMinZ > tileBounds[off + 3] ||
                qMaxZ < tileBounds[off + 1]
              ) {
                continue;
              }
              if (tileWorlds[i].probeSphere!(center, radius)) return true;
            }
            return false;
          },
        }
      : {}),
  };
}

export interface TileBvhCacheOptions {
  /** Maximum total resident bytes across cached tile BVHs (default 512 MiB). */
  maxBytes?: number;
}

/** Byte-bounded LRU cache for per-tile flat CollisionWorlds.
 * Sliding, expanding, or bisecting windows pull overlapping tiles from this
 * cache in O(1) without rebuilding combined BVHs.
 */
export function createTileBvhCache(options?: TileBvhCacheOptions) {
  const maxBytes = options?.maxBytes ?? 512 * 1024 * 1024;
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error('Invalid tile BVH cache byte budget');
  }
  const entries = new Map<string, { tile: CollisionTile; bytes: number }>();
  let totalBytes = 0;
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  const evict = () => {
    while (totalBytes > maxBytes && entries.size > 1) {
      const oldestKey = entries.keys().next().value!;
      const oldest = entries.get(oldestKey)!;
      entries.delete(oldestKey);
      totalBytes -= oldest.bytes;
      evictions++;
    }
  };

  return {
    get(key: string): CollisionTile | undefined {
      const entry = entries.get(key);
      if (!entry) {
        misses++;
        return undefined;
      }
      hits++;
      // Refresh LRU order.
      entries.delete(key);
      entries.set(key, entry);
      return entry.tile;
    },
    getOrBuild(key: string, build: () => CollisionTile): CollisionTile {
      const existing = entries.get(key);
      if (existing) {
        hits++;
        entries.delete(key);
        entries.set(key, existing);
        return existing.tile;
      }
      misses++;
      const tile = build();
      const bytes = Math.max(1, tile.estimatedBytes ?? 4096);
      entries.set(key, { tile, bytes });
      totalBytes += bytes;
      evict();
      return tile;
    },
    set(tile: CollisionTile) {
      const prev = entries.get(tile.key);
      if (prev) {
        totalBytes -= prev.bytes;
        entries.delete(tile.key);
      }
      const bytes = Math.max(1, tile.estimatedBytes ?? 4096);
      entries.set(tile.key, { tile, bytes });
      totalBytes += bytes;
      evict();
    },
    delete(key: string): boolean {
      const prev = entries.get(key);
      if (!prev) return false;
      totalBytes -= prev.bytes;
      entries.delete(key);
      return true;
    },
    clear() {
      entries.clear();
      totalBytes = 0;
    },
    stats() {
      return {
        entries: entries.size,
        bytes: totalBytes,
        maxBytes,
        hits,
        misses,
        evictions,
      };
    },
  };
}
