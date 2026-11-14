/** Host-side normalization and resource work use this seam without importing v1 paths.
 * Browser consumers use solver results and playback instead of algorithm helpers. */
export {
  createPhysicalPreparation,
  physicalWork,
  physicalWorkPlan,
  readPhysicalWork,
  physicalTileSpan,
  physicalMargin,
  physicalCoverage,
  validateWaypoints,
} from '#@/src/v1/solver/physical/host.ts';
export type { PhysicalWork } from '#@/src/solver/resources.ts';
export { createGroundPlanner } from '#@/src/v1/route/ground.ts';
export { routeFrom } from '#@/src/v1/route/routes.ts';
export { createGoalProjector } from '#@/src/model/goals.ts';
export { createWallChecker } from '#@/src/model/walls.ts';
export { jumpDuration } from '#@/src/v1/motion/jumps.ts';
export { retimeGroundRoute } from '#@/src/v1/resource/locomotion.ts';
export { createDeviceConnections } from '#@/src/v1/solver/physical/devices.ts';
export { sweepSupports, supportBounds, supportEndpoints } from '#@/src/model/supports.ts';
export type { WindowResources } from '#@/src/solver/resources.ts';

export { refineGoalGround } from '#@/src/v1/solver/ground-refinement.ts';
