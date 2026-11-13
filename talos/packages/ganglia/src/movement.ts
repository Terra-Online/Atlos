import type { Vec3 } from '#@/src/geometry.ts';

export type MovementMode = 'walk' | 'rope' | 'jump' | 'drop' | 'launch';

export interface BoostUse {
  id: string;
  multiplier: number;
  duration: number;
}

/** Reproducible control input. Model values are checked against scene rules by the verifier. */
export interface Flight {
  kind: 'flight' | 'run-off';
  start: Vec3;
  end: Vec3;
  model: JumpModel;
  control: {
    mode: 'jump' | 'drop';
    exit?: [number, number];
    speedFraction?: number;
    terminal?: 'average' | 'balanced' | 'fast';
    horizontalSplit?: number;
    horizontalWaypoint?: [number, number];
    expireAfter?: number;
    expiredHorizontalSpeed?: number;
  };
}

export interface Segment {
  flight?: Flight;
  /** Authored traversal semantics; connection identifiers remain opaque to renderers. */
  traversal?: 'moving-support';
  boostExpiry?: number;
  boost?: BoostUse;
  mode: MovementMode;
  points: Vec3[];
  times: number[];
  connection?: string;
  gait?: 'run' | 'sprint' | 'dash';
  requiredGait?: 'sprint';
}

export interface JumpModel {
  gravity: number;
  fallingGravity: number;
  maxJumpHeight: number;
  maxFallingSpeed: number;
  apexTime: number;
  maxHorizontalSpeed: number;
  airAcceleration?: number;
  airDeceleration?: number;
  /** Optional jump impulse ceiling and decay of speed above the sustained air limit. */
  startHorizontalSpeed?: number;
  airOverspeedDeceleration?: number;
}

/** Explicit source-derived interaction volume. No per-game defaults are supplied.
 * Airborne collection goals finish at the first in-flight hit. */
export interface InteractionGoal {
  airborne?: boolean;
  radius: number;
  maxVertical?: number;
  facing?: Vec3;
  halfAngle?: number;
}

/** Explicit movement policy. No unverified game-specific energy defaults are inferred. */
export interface LocomotionModel {
  speed: number;
  sprintSpeed: number;
  sprintAcceleration: number;
  /** Optional ground dash pulse, sharing the stamina pool and cooldown across actions. */
  dash?: { speed: number; duration: number; cooldown: number; cost: number };
  /** Movement modes that preserve an already active sprint across their authored trajectory. */
  sprintThrough?: Exclude<MovementMode, 'walk'>[];
  stamina?: {
    capacity: number;
    initial: number;
    activationCost?: number;
    sprintDrain?: number;
    recoveryDuringSprint?: boolean;
    recoveryDuringNonWalk?: boolean;
    recoveryRate: number;
    recoveryDelay: number;
    reserve: number;
  };
}

export interface SpeedBoost extends BoostUse {
  position: Vec3;
  interaction: InteractionGoal;
}

/** Search budgets belong to solver policy; shared rules consume LocomotionModel. */
export interface LocomotionOptions extends LocomotionModel {
  search?: { maxLabels?: number; maxExpanded?: number };
}
