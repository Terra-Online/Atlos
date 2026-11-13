import type { Vec3, Portal, Wall } from '#@/src/geometry.ts';
import type { BoostUse, Segment, MovementMode, LocomotionOptions } from '#@/src/movement.ts';

export type Route =
  | {
      status: 'complete';
      /** Chosen resource controls, replayed without running a scheduler search. */
      schedule?: { segments: Segment[]; allowSprint: boolean; allowDash: boolean }[];
      placements?: { device: string; position: Vec3 }[];
      boosts?: (BoostUse & { position: Vec3; elapsed: number })[];
      start: string;
      cost: number;
      arrivalCost: number;
      length: number;
      search?: ResourceSearch;
      goalHit?: { segment: number; time: number; position: Vec3 };
      locomotion?: {
        initial: number;
        final: number;
        minimum: number;
        dashes?: number;
        dash?: { speed: number; duration: number; cooldown: number; cost: number };
        search?: { truncated: boolean; maxLabels: number };
      };
      points: Vec3[];
      segments: Segment[];
    }
  | { status: 'unmapped' | 'no-verified-route'; search?: ResourceSearch };

export interface ResourceSearch {
  truncated: boolean;
  expanded: number;
  maxLabels: number;
  maxExpanded: number;
}

export interface GroundArrival {
  id: string;
  position: Vec3;
  cost: number;
  state: 'available' | 'locked' | 'unknown';
}

export interface GroundConnection {
  flight?: Segment['flight'];
  traversal?: 'moving-support';
  /** A collection action ends in flight and cannot be used as a transfer. */
  terminal?: true;
  /** Conditional trajectories are unavailable without the matching active boost. */
  requiredBoost?: string;
  id: string;
  mode: Exclude<MovementMode, 'walk'>;
  points: Vec3[];
  times: number[];
  state: 'open' | 'closed' | 'unknown';
  /** Explicit collision-support allowance, bounded by maxVertical and body radius. Defaults to 1e-6 m. */
  endpointTolerance?: number;
  /** Non-ground entry condition, checked against active gait by the locomotion scheduler.
   * Ground planners exclude this connection when no locomotion policy is supplied.
   */
  requiredGait?: 'sprint';
  /** Optional explicit support faces, validated at the authored endpoint tolerance. */
  fromSurface?: string;
  toSurface?: string;
}

export interface GroundOptions {
  activeBoost?: string;
  speed: number;
  maxVertical: number;
  walls: Wall[];
  profile: { radius: number; height: number };
  connections?: GroundConnection[];
  portals?: Portal[];
  locomotion?: LocomotionOptions;
}
