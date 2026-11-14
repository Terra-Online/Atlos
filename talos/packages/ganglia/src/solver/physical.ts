import type { BuildOptions } from '#@/src/build.ts';
import type { CollisionGeometry, Surface, Vec3, Wall } from '#@/src/geometry.ts';
import type { InteractionGoal, LocomotionOptions } from '#@/src/movement.ts';
import type { GroundOptions } from '#@/src/route.ts';

export type PhysicalGround = {
  surfaces: Surface[];
  options: GroundOptions & { profile: NonNullable<GroundOptions['profile']> };
  build?: Partial<BuildOptions & { tileCells: number }>;
};

export interface PhysicalMovement {
  model: {
    gravity: number;
    fallingGravity: number;
    maxJumpHeight: number;
    maxFallingSpeed: number;
    apexTime: number;
    maxHorizontalSpeed: number;
    startHorizontalSpeed: number;
    airOverspeedDeceleration: number;
    airAcceleration: number;
    airDeceleration: number;
  };
  maxSlope: number;
  runAirSpeed: number;
  stepUp: number;
  stepDown: number;
}

export interface PhysicalInput {
  ground: PhysicalGround;
  collision: CollisionGeometry;
  roundedWalls?: Wall[];
  movement: PhysicalMovement;
  locomotion: LocomotionOptions;
  devices?:
    | (DeviceFacts & { movingSupports?: SweptSupport[]; followingSupports?: FollowingSupport[] })
    | null;
}

export interface DeviceFacts {
  devices: {
    id: string;
    kind: string;
    position: Vec3;
    goal: { position: Vec3; interaction: InteractionGoal } | null;
    seeds: Vec3[];
    unitScale: boolean;
    resolved: boolean;
    speed: number;
    overhead: number;
    duration: unknown;
    fixedLaunch: boolean;
    aim: unknown;
    height: number;
    aimClearance: number;
    boostMultiplier: number;
  }[];
  ropes: { bottom: string; top: string }[];
}

/** world-axis-aligned bounds enclosing all collider bodies at one sampled pose */
export interface PoseBounds {
  min: Vec3;
  max: Vec3;
}

/** source pose interval of one body contributing a support face or transfer */
export interface PoseSpan {
  fromPose: number;
  toPose: number;
  body: number;
}

/** query-independent phase-free support, scoped to one moving body's authored path */
export interface SweptSupport {
  id: string;
  family: 'platform' | 'conveyor' | 'seesaw' | 'water-floater' | 'forklift';
  level: string;
  model: string;
  /** local authored control, retained alongside the fully-enabled planning assumption */
  control?: {
    kind: 'forklift';
    logicType: 24;
    start: Vec3;
    end: Vec3;
    speed: number;
    initialState: number;
    initiallyOn: boolean;
    assumption: 'fully-enabled';
  };
  /** world-axis-aligned endpoint boxes for illustration; separate from navigation support */
  endpoints?: {
    initial: PoseBounds;
    terminal: PoseBounds;
  };
  /** sampled whole-support boxes; translation spans permit interpolation, seesaw states remain discrete */
  poses?: PoseBounds[];
  surfaces: Surface[];
  /** parallel to surfaces, retaining every pose interval contributing a deduplicated face */
  surfacePoses?: PoseSpan[][];
  /** rides connect supported poses without making other times into solid obstacles */
  transfers: {
    from: Vec3;
    to: Vec3;
    speed: number | null;
    fromPose?: number;
    toPose?: number;
    body?: number;
  }[];
  assumption: 'phase-free-swept-support';
}

/** One movable support with an authored activity range, independent of its transport choreography. */
export interface FollowingSupport {
  id: string;
  level: string;
  model: string;
  spawn: Vec3;
  bodies: Vec3[][];
  geometryKind: 'box' | 'convex';
  /** Three-dimensional distance from the restored spawn, not an arbitrary endpoint. */
  maxDistance: number;
  initialState: number;
  assumption: 'placement-within-activity-range';
}
