import type { Vec3 } from '#@/src/geometry.ts';
import type { InteractionGoal } from '#@/src/movement.ts';
import type { SolverSettings } from '#@/src/solver/contract.ts';

export interface GangliaV2Config extends SolverSettings {
  readonly algorithm: 'ganglia-v2';
  readonly seed: number;
  readonly populationSize: number;
  readonly attemptsPerRound: number;
  readonly stagnantRounds: number;
  readonly improvementThreshold: number;
}

/** Scene annotations supplied before serving queries, including airborne targets. */
export interface NavigationMark {
  position: Vec3;
  interaction: InteractionGoal;
}

interface NavigationRegion {
  min: Vec3;
  max: Vec3;
}

export interface FlightRegionLink {
  from: NavigationRegion;
  to: NavigationRegion;
}

/** Points nominate an exact link. Regions ask preparation to find a flight
 * between supported contacts inside the two volumes. Both links are directed. */
export type NavigationLink = { from: Vec3; to: Vec3 } | FlightRegionLink;

export interface OptimizationRound {
  elapsedMs: number;
  attempts: number;
  accepted: number;
  bestCost: number;
  relativeImprovement: number;
}

export interface V2Diagnostics {
  backboneBuildMs: number;
  initializationMs: number;
  initialization: {
    starts: { id: string; projected: Vec3 | null; attachments: number }[];
    goalPositions: number;
    goalAttachments: number;
    reachedNodes: number;
    failureStage?:
      | 'start-contact'
      | 'start-attachment'
      | 'goal-attachment'
      | 'ordinary-connectivity'
      | 'route-composition';
    nodesReachingGoal?: number;
    nearestReached?: Vec3[];
    nearestGaps?: { from: Vec3; to: Vec3; distance: number; action: string | null }[];
  };
  initialCost: number | null;
  seed: number;
  nodeCount: number;
  edgeCount: number;
  rounds: OptimizationRound[];
}

export const gangliaV2Defaults: GangliaV2Config = Object.freeze({
  algorithm: 'ganglia-v2',
  batchConcurrency: 1,
  seed: 1,
  populationSize: 4,
  attemptsPerRound: 100,
  stagnantRounds: 3,
  improvementThreshold: 0.001,
});
