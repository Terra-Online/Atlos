import type { Vec3 } from '#@/src/geometry.ts';
export { createCollisionWorld } from '#@/src/v1/geo/collision.ts';

export interface CollisionOptions {
  /** Inclusive XZ rectangle in world metres, retaining full vertical coverage.
   * Triangles whose XZ bounds intersect this rectangle are indexed. All source
   * geometry is validated even outside the selected rectangle. Queries outside
   * this rectangle throw; capsule sweeps include radius and inflation in that guard.
   */
  bounds?: { min: [number, number]; max: [number, number] };
  /** Optional exact-query memoization for repeated use of the immutable world.
   * Nonnegative integer; defaults to zero (disabled). The capacity is shared by
   * support and capsule queries, including null results, with FIFO replacement.
   * Parameter validation and scope guards run before lookup. Cached returned
   * objects are copied so callers cannot mutate a later result.
   */
  queryCacheSize?: number;
}

export interface Capsule {
  radius: number;
  height: number;
  inflation?: number;
}

export interface CollisionWorld {
  /** Informational snapshot of the indexed XZ rectangle, or null for an unbounded index. */
  readonly bounds?: { min: [number, number]; max: [number, number] } | null;
  /** Optional diagnostic snapshot of the factory's exact-query cache. Disabled
   * caches report zero entries/hits/misses. Query-validation failures do not count.
   */
  readonly queryCacheStats?: { capacity: number; entries: number; hits: number; misses: number };
  /** Input triangle indices whose inclusive XZ bounds overlap the rectangle,
   * sorted in original input order. All heights are included. Throws if the
   * rectangle is malformed or exceeds this world's indexed scope. A candidate
   * triangle may not geometrically intersect the rectangle; this is broad phase.
   */
  trianglesInBounds?(bounds: { min: [number, number]; max: [number, number] }): number[];
  /** Exact vertical triangle support, with unchanged XZ coordinates. Height limits
   * are metres and maxSlope is degrees (greater than 0 and less than 90). Only
   * upward-facing triangles within the slope limit qualify. The closest height is
   * selected for point queries; equal distances prefer the higher surface. Capsule clearance, surface
   * state, initial occupancy and complete collision coverage remain caller checks.
   * Optional radius returns bottom-sphere feet support over triangle interiors,
   * edges and corners, selecting the highest support within the height limits.
   * Its XZ footprint must fit inside an explicitly bounded world.
   * Radius defaults to zero, preserving exact vertical point support.
   */
  groundAt(
    position: Vec3,
    options: { maxUp: number; maxDown: number; maxSlope: number; radius?: number },
  ): { position: Vec3; triangle: number; normal: Vec3 } | null;
  /** Feet positions; upright capsule translated continuously along a straight segment.
   * Inflation enlarges the capsule in every direction, e.g. for a bounded curve deviation.
   * Any touching triangle is returned, not necessarily the earliest impact. Distance is
   * from the swept axis to that triangle. Null does not establish landing support, motion
   * feasibility, initial occupancy inside solids, active state or complete world coverage.
   * Throws if the full swept XZ body footprint lies outside an explicitly bounded world.
   */
  sweepCapsule(
    start: Vec3,
    end: Vec3,
    profile: Capsule,
  ): { triangle: number; distance: number } | null;
}
