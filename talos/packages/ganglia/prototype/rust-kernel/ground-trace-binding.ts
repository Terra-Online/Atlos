import { loadNativeLibrary } from '#@/prototype/rust-kernel/native.ts';
import type { Vec3 } from '#@/src/geometry.ts';

export interface NativeGroundTraceSnapshot {
  /** Snapshot row order defines triangle IDs; each row has three XYZ vertices. */
  triangles: Float64Array;
  neighborOffsets: Uint32Array;
  neighborTargets: Uint32Array;
  neighborOpposites: Uint32Array;
  /** Six coordinates per neighbor; entries without portals are ignored. */
  portalEndpoints: Float64Array;
  hasPortal: Uint8Array;
}

export interface NativeGroundTraceIndex {
  /** Empty or packed XYZ points before collinear simplification and wall checks. */
  trace(start: Float64Array, end: Float64Array, supportIds: Uint32Array): Float64Array;
}

export const { GroundTraceIndex } = loadNativeLibrary() as {
  GroundTraceIndex: new (snapshot: NativeGroundTraceSnapshot) => NativeGroundTraceIndex;
};

export interface GroundTraceTriangle {
  id: number;
  vertices: readonly (readonly number[])[];
  neighbours: readonly {
    triangle: { id: number };
    opposite: number;
    portal?: { start: readonly number[]; end: readonly number[] };
  }[];
}

/** Call after neighbors are complete. The support locator, collinear simplifier
 * and wall checker remain owned by the TypeScript straightener.
 */
export function createRustGroundTracer(triangles: readonly GroundTraceTriangle[]) {
  const edges = triangles.reduce((sum, triangle) => sum + triangle.neighbours.length, 0);
  const snapshot: NativeGroundTraceSnapshot = {
    triangles: new Float64Array(triangles.length * 9),
    neighborOffsets: new Uint32Array(triangles.length + 1),
    neighborTargets: new Uint32Array(edges),
    neighborOpposites: new Uint32Array(edges),
    portalEndpoints: new Float64Array(edges * 6),
    hasPortal: new Uint8Array(edges),
  };
  let edge = 0;
  for (let id = 0; id < triangles.length; id++) {
    const triangle = triangles[id];
    for (let corner = 0; corner < 3; corner++)
      snapshot.triangles.set(triangle.vertices[corner], id * 9 + corner * 3);
    snapshot.neighborOffsets[id] = edge;
    for (const neighbour of triangle.neighbours) {
      snapshot.neighborTargets[edge] = neighbour.triangle.id;
      snapshot.neighborOpposites[edge] = neighbour.opposite;
      if (neighbour.portal) {
        snapshot.hasPortal[edge] = 1;
        snapshot.portalEndpoints.set(neighbour.portal.start, edge * 6);
        snapshot.portalEndpoints.set(neighbour.portal.end, edge * 6 + 3);
      }
      edge++;
    }
  }
  snapshot.neighborOffsets[triangles.length] = edge;
  const index = new GroundTraceIndex(snapshot);
  return (start: Vec3, end: Vec3, supports: readonly { id: number }[]): Vec3[] | null => {
    const packed = index.trace(
      Float64Array.from(start),
      Float64Array.from(end),
      Uint32Array.from(supports, (triangle) => triangle.id),
    );
    if (!packed.length) return null;
    const points: Vec3[] = [];
    for (let offset = 0; offset < packed.length; offset += 3)
      points.push([packed[offset], packed[offset + 1], packed[offset + 2]]);
    return points;
  };
}
