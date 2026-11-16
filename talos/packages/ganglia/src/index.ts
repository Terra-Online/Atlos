export { sampleJourney, sampleRoute } from '#@/src/playback.ts';
export type { Vec3, Surface, Portal, Wall } from '#@/src/geometry.ts';
export type { Route, GroundArrival, GroundConnection, GroundOptions } from '#@/src/route.ts';
export type {
  Segment,
  SpeedBoost,
  LocomotionOptions,
  LocomotionModel,
  InteractionGoal,
  JumpModel,
} from '#@/src/movement.ts';

export { prepareRouteSolver, gangliaV1Defaults } from '#@/src/solver/index.ts';
export type {
  PreparedRouteSolver,
  SolverConfig,
  SolverSettings,
  GangliaV1Config,
  SolverInput,
  SceneInput,
  PhysicalInput,
  RouteQuery,
  RouteResult,
  SolveOptions,
  RouteEvent,
  SceneResources,
  SceneNavigation,
  SceneTerminal,
} from '#@/src/solver/index.ts';
