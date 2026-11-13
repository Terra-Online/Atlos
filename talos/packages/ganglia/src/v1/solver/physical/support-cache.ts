import type { Surface } from '#@/src/geometry.ts';
import { releaseVerticalProjectionIndex } from '#@/src/v1/geo/support-projector.ts';
import { releaseSupportSnapshot } from '#@/src/v1/geo/support-snapshot.ts';
import { releaseLandingMetadata } from '#@/src/v1/motion/landings.ts';

/** Preloaded inputs can outlive their prepared region. Drop pure lookup memos
 * when that owner retires; existing projectors retain their own snapshots. */
export function releaseSupportCaches(surfaces: Surface[]) {
  releaseVerticalProjectionIndex(surfaces);
  for (const surface of surfaces) {
    releaseSupportSnapshot(surface);
    releaseLandingMetadata(surface);
  }
}
