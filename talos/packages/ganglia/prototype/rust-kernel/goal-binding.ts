import { loadNativeLibrary } from '#@/prototype/rust-kernel/native.ts';
import type { GoalClip, GoalGeometryFactory } from '#@/src/v1/motion/goals.ts';

interface NativeGoalProjectionIndex {
  projectPoint(target: Float64Array, candidates: Uint32Array, maxVertical: number): Float64Array;
  closestSurfaces(target: Float64Array, candidates: Uint32Array, clip: GoalClip): Float64Array;
}

const { GoalProjectionIndex } = loadNativeLibrary() as {
  GoalProjectionIndex: new (
    positions: Float64Array,
    surfaceOffsets: Uint32Array,
  ) => NativeGoalProjectionIndex;
};

export const createRustGoalGeometry: GoalGeometryFactory = (surfaces) => {
  const count = surfaces.reduce((sum, surface) => sum + surface.vertices.length, 0);
  const positions = new Float64Array(count * 3);
  const offsets = new Uint32Array(surfaces.length + 1);
  let vertex = 0;
  for (let id = 0; id < surfaces.length; id++) {
    offsets[id] = vertex;
    for (const point of surfaces[id].vertices) positions.set(point, vertex++ * 3);
  }
  offsets[surfaces.length] = vertex;
  const index = new GoalProjectionIndex(positions, offsets);
  return {
    projectPoint(target, maxVertical, candidates) {
      const result = index.projectPoint(
        Float64Array.from(target),
        Uint32Array.from(candidates),
        maxVertical,
      );
      return result.length
        ? {
            surface: surfaces[result[0]].id,
            position: [result[1], result[2], result[3]],
            distance: result[4],
          }
        : null;
    },
    closestSurfaces(target, candidates, clip) {
      const packed = index.closestSurfaces(
        Float64Array.from(target),
        Uint32Array.from(candidates),
        clip,
      );
      const result = [];
      for (let offset = 0; offset < packed.length; offset += 5) {
        const id = packed[offset];
        result.push({
          index: id,
          surface: surfaces[id].id,
          position: [packed[offset + 1], packed[offset + 2], packed[offset + 3]] as [
            number,
            number,
            number,
          ],
          distance: packed[offset + 4],
        });
      }
      return result;
    },
  };
};
