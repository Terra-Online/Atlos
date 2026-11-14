import type { ServicePreparation } from '#@/src/solver/contract.ts';

/** Fixed policy for one ganglia-v1 solver. Start from gangliaV1Defaults when
 * changing individual settings. Movement and scene snapshots are separate inputs.
 *
 * V1 tries walking, known devices and general actions in that order. It expands
 * or splits physical windows on failure and compares complete resource-timed
 * routes. This ordering, candidate ranking, local refinement and budget sharing
 * belong to the implementation; this config does not describe an arbitrary pipeline.
 */
export interface GangliaV1Config {
  readonly algorithm: 'ganglia-v1' | 'ganglia-v1-ts' | 'ganglia-v1-rust';
  /** Service startup trains reusable physical connections, freezes the catalog,
   * then warms the same prepared solver. Request populations belong to the host. */
  readonly preparation: ServicePreparation;
  /** Candidate work per local search, renewed for other windows/arrivals/retries.
   * This is not a whole-query work limit. V1 caps optional discovery at 640 when
   * walking or known devices already provide a complete route. */
  readonly maxCandidates: number;
  /** Broad improvement work after feasibility. Local comparisons and device-entry
   * recovery have their own shares of the remaining candidate work. */
  readonly maxShortcutCandidates: number;
  /** Boundary sampling distance in metres. Smaller spacing can increase work. */
  readonly sampleSpacing: number;
  /** Retained action links per discovery call, not per complete scene query. */
  readonly maxLinks: number;
  /** Maximum global corridor/arrival attempts for one scene query. */
  readonly maxAttempts: number;
  /** Maximum concurrent scene batch lanes. Local adapters may execute serially. */
  readonly batchConcurrency: number;
  /** Physical tile width in metres; must match the supplied resource tiling. */
  readonly tileSpan: number;
  /** Resource coverage alignment in metres; must match the resource adapter. */
  readonly gridSpan: number;
  /** Maximum physical tiles in one window. */
  readonly maxTiles: number;
  /** Initial window padding in metres; failed coverage can expand this padding. */
  readonly margin: number;
  /** Vertical allowance in metres for intermediate window endpoints. V1 keeps
   * horizontal deviation within 0.5 m; final targets use their query semantics. */
  readonly maxTargetError: number;
}

export const gangliaV1Defaults: GangliaV1Config = Object.freeze({
  algorithm: 'ganglia-v1',
  preparation: Object.freeze({ trainingQueries: 10, warmupQueries: 2 }),
  maxCandidates: 8000,
  maxShortcutCandidates: 512,
  sampleSpacing: 1,
  maxLinks: 64,
  maxAttempts: 6,
  batchConcurrency: 1,
  tileSpan: 38.4,
  gridSpan: 32,
  maxTiles: 16,
  margin: 8,
  maxTargetError: 3,
});

export function validateServicePreparation(policy: ServicePreparation | undefined) {
  if (
    !policy ||
    !Number.isSafeInteger(policy.trainingQueries) ||
    policy.trainingQueries < 1 ||
    !Number.isSafeInteger(policy.warmupQueries) ||
    policy.warmupQueries < 1
  )
    throw new Error('Ganglia V1 service requires positive trainingQueries and warmupQueries');
}
