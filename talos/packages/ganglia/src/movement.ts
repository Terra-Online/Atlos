import type { Vec3 } from '#@/src/geometry.ts';

export type MovementMode = 'walk' | 'rope' | 'jump' | 'drop' | 'launch';

export interface BoostUse {
  id: string;
  multiplier: number;
  duration: number;
}

export interface Segment {
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
export interface LocomotionOptions {
  /** Explicit limits for resource-state fallback search. */
  search?: { maxLabels?: number; maxExpanded?: number };
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
