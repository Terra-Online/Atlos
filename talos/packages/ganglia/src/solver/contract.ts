import type { CollisionOptions } from '#@/src/collision.ts';
import type { Vec3, Surface, CollisionGeometry, Portal, Wall } from '#@/src/geometry.ts';
import type { InteractionGoal, JumpModel, LocomotionOptions, SpeedBoost } from '#@/src/movement.ts';
import type { GroundArrival, GroundConnection, Route } from '#@/src/route.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import type { WindowJob, SceneResources, SceneNavigation } from '#@/src/solver/resources.ts';

/** One immutable physical snapshot. Keep inputs unchanged until close(). */
export interface SceneInput {
  surfaces: Surface[];
  collision: CollisionGeometry;
  collisionOptions?: CollisionOptions;
  walls: Wall[];
  connections?: GroundConnection[];
  portals?: Portal[];
  boosts?: SpeedBoost[];
  movement: {
    activeBoost?: string;
    speed: number;
    maxVertical: number;
    profile: { radius: number; height: number };
    locomotion?: LocomotionOptions;
    model: JumpModel;
    runAirSpeed: number;
    maxSlope: number;
    maxDrop: number;
    maxHorizontalDistance: number;
  };
}

/** Required work before a prepared algorithm is ready to serve requests. */
export interface ServicePreparation {
  /** Discover reusable connections, then freeze the catalog before serving. */
  readonly trainingQueries: number;
  /** Exercise the prepared service with explicitly declared requests before serving. */
  readonly warmupQueries: number;
}

/** Execution identity shared by solver implementations. Algorithm policy is adapter-owned. */
export interface SolverSettings {
  readonly algorithm: string;
  readonly batchConcurrency: number;
  readonly preparation?: ServicePreparation;
}

export interface RouteQuery {
  starts: GroundArrival[];
  goal: Vec3;
  interaction?: InteractionGoal;
  waypoints?: Vec3[];
}

export interface RouteResult {
  route: Route;
  connections: GroundConnection[];
  diagnostics: { truncated: boolean; candidateAttempts?: number };
  reason?: string;
  /** A verified target approach that does not yet connect to a requested start. */
  partial?: boolean;
  arrival?: GroundArrival;
  groundedTarget?: Vec3;
  supportBoxes?: {
    min: Vec3;
    max: Vec3;
    device: string;
    family: string;
    role: 'board' | 'leave' | 'use';
  }[];
}

export type RouteEvent =
  | {
      type: 'progress';
      phase: 'prepare' | 'search' | 'refine' | 'validate';
      completed?: number;
      total?: number;
    }
  | { type: 'candidate'; result: RouteResult; optimizing: boolean };
export interface SolveOptions {
  /** Cancellation is cooperative at preparation, search-progress and candidate checkpoints. */
  signal?: AbortSignal;
  onEvent?: (event: RouteEvent) => void;
}

export interface PreparedRouteSolver<Config extends SolverSettings = SolverSettings> {
  readonly config: Config;
  /** Fresh search state; immutable preparation and geometry proofs may be reused.
   * No completed-route cache. Inputs remain unchanged until the promise settles. */
  solve(query: RouteQuery, options?: SolveOptions): Promise<RouteResult>;
  /** One whole-workload submission. Implementations choose scheduling and may
   * solve in parallel. Results correspond to input order, including unavailable
   * and truncated results. Each request has its own search budget and state. */
  solveBatch(
    queries: readonly RouteQuery[],
    options?: { signal?: AbortSignal },
  ): Promise<readonly RouteResult[]>;
  /** Await submitted work before closing. Idempotent; later solves reject. */
  close(): Promise<void>;
}

export type SolverInput<Source, Job extends WindowJob> =
  | { kind: 'surfaces'; input: SceneInput }
  | { kind: 'physical'; input: PhysicalInput }
  | {
      kind: 'scene';
      scene: { scene: string; source: Source; walls: Wall[]; navigation: SceneNavigation };
      resources: SceneResources<Source, Job>;
      locomotion: LocomotionOptions;
    };
