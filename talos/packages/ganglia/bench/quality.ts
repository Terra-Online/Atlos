import { isDeepStrictEqual } from 'node:util';

import type { RouteQuery } from '@opendfieldmap/ganglia';

import { QUERY_SLO_MS } from '#@/bench/slo.ts';

export interface QualityRow {
  id: string;
  status: string;
  partial: boolean;
  cost: number | null;
  outcomeSha256?: string;
  truncated?: boolean;
  reason?: string | null;
  timedOut?: boolean;
  wallMs?: number;
}

export const isTimedOut = (row: QualityRow) =>
  row.timedOut === true ||
  row.reason === 'timeout' ||
  row.status === 'timeout' ||
  (row.wallMs !== undefined && row.wallMs > QUERY_SLO_MS);
const complete = (row: QualityRow) => row.status === 'complete' && !row.partial && !isTimedOut(row);
const cost = (row: QualityRow) => {
  if (row.cost === null || !Number.isFinite(row.cost) || row.cost < 0)
    throw new Error(`Invalid modeled route cost: ${row.id}`);
  return row.cost;
};
const costs = (rows: readonly QualityRow[]) => rows.filter(complete).map(cost);

/** Model seconds include arrival overhead and the resource-timed motion schedule.
 * A failed/partial request cannot lower the workload's total quality cost.
 * Length alone would penalize useful faster movement and device trajectories. */
export function summarizeQuality(rows: readonly QualityRow[]) {
  const values = costs(rows);
  const sum = values.reduce((total, cost) => total + cost, 0);
  return {
    objective: 'modeled-travel-time-seconds' as const,
    requested: rows.length,
    completed: values.length,
    sloMs: QUERY_SLO_MS,
    sloCompleted: values.length,
    sloMet: values.length === rows.length,
    timedOut: rows.filter(isTimedOut).length,
    failed: rows.length - values.length,
    completionRate: rows.length ? values.length / rows.length : null,
    totalCostSeconds: values.length === rows.length ? sum : null,
    meanCompletedCostSeconds: values.length ? sum / values.length : null,
  };
}

/** Ratios use a fixed measured reference, not an optimality certificate.
 * Compare completion first; paired costs cannot compensate for lost solutions.
 * Per-query ratios give short and long queries equal weight in the geometric mean. */
export function compareQuality(rows: readonly QualityRow[], reference: readonly QualityRow[]) {
  costs(rows);
  costs(reference);
  const previous = new Map(reference.map((row) => [row.id, row]));
  if (previous.size !== reference.length || new Set(rows.map((row) => row.id)).size !== rows.length)
    throw new Error('Duplicate benchmark query id');
  if (rows.length !== reference.length) throw new Error('Reference query ids do not match');
  const lostSolutions: string[] = [],
    gainedSolutions: string[] = [];
  const pairs = rows.flatMap((row) => {
    const before = previous.get(row.id);
    if (!before) throw new Error('Reference query ids do not match');
    if (complete(before) && !complete(row)) lostSolutions.push(row.id);
    if (!complete(before) && complete(row)) gainedSolutions.push(row.id);
    if (!complete(before) || !complete(row)) return [];
    const current = cost(row),
      prior = cost(before);
    return [
      {
        id: row.id,
        referenceCostSeconds: prior,
        costSeconds: current,
        deltaSeconds: current - prior,
        costRatio: prior === 0 ? (current === 0 ? 1 : null) : current / prior,
      },
    ];
  });
  const unboundedCostRegressions = pairs.filter((row) => row.costRatio === null).length;
  const ratios = pairs.flatMap((row) => (row.costRatio === null ? [] : [row.costRatio]));
  const geometricMeanCostRatio =
    !pairs.length || unboundedCostRegressions
      ? null
      : ratios.includes(0)
        ? 0
        : Math.exp(ratios.reduce((sum, ratio) => sum + Math.log(ratio), 0) / ratios.length);
  return {
    pairedCompleted: pairs.length,
    ...(rows.every((row) => row.outcomeSha256 && previous.get(row.id)?.outcomeSha256)
      ? {
          identicalOutcomes: rows.filter(
            (row) => row.outcomeSha256 === previous.get(row.id)!.outcomeSha256,
          ).length,
        }
      : {}),
    lostSolutions,
    gainedSolutions,
    referenceTimedOut: reference.filter(isTimedOut).length,
    timedOut: rows.filter(isTimedOut).length,
    recoveredTimeouts: rows
      .filter((row) => complete(row) && isTimedOut(previous.get(row.id)!))
      .map((row) => row.id),
    geometricMeanCostRatio,
    worstCostRatio: !ratios.length || unboundedCostRegressions ? null : Math.max(...ratios),
    unboundedCostRegressions,
    pairs,
  };
}

export function qualityGate(
  rows: readonly (QualityRow & {
    sameOutcomeAsPrewarm: boolean;
    sameTruncationAsPrewarm: boolean;
  })[],
  comparison: ReturnType<typeof compareQuality> | undefined,
  limits = { geometricMeanCostRatio: 1.01, worstCostRatio: 1.05 },
) {
  if (Object.values(limits).some((value) => !Number.isFinite(value) || value < 1))
    throw new Error('Invalid benchmark quality limits');
  const failures: string[] = [];
  if (rows.some((row) => !row.sameOutcomeAsPrewarm || !row.sameTruncationAsPrewarm))
    failures.push('Measured results differ from prewarm');
  if (rows.some(isTimedOut)) failures.push('Queries exceeded the 300,000 ms SLO');
  if (rows.some((row) => !complete(row)))
    failures.push('Some queries have no complete route within the SLO');
  if (comparison) {
    if (comparison.lostSolutions.length) failures.push('Lost complete routes');
    if (comparison.unboundedCostRegressions) failures.push('A zero-cost route became more costly');
    if (
      comparison.geometricMeanCostRatio !== null &&
      comparison.geometricMeanCostRatio > limits.geometricMeanCostRatio
    )
      failures.push('Geometric mean route cost exceeds limit');
    if (comparison.worstCostRatio !== null && comparison.worstCostRatio > limits.worstCostRatio)
      failures.push('Worst route cost exceeds limit');
  }
  return { passed: !failures.length, failures, ...(comparison ? { limits } : {}) };
}

type Binding = {
  scene: string;
  source: unknown;
  hashes: Record<string, string>;
  gameAdapterSha256: string;
  cases: readonly { id: string; query: RouteQuery }[];
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function readReference(value: unknown, binding: Binding): QualityRow[] {
  if (
    !record(value) ||
    !record(value.hashes) ||
    !record(value.batch) ||
    !Array.isArray(value.batch.results)
  )
    throw new Error('Invalid benchmark reference report');
  // Input paths can change across machines; compare all consumed content hashes.
  if (
    value.scene !== binding.scene ||
    !isDeepStrictEqual(value.source, binding.source) ||
    !isDeepStrictEqual(Object.values(value.hashes).sort(), Object.values(binding.hashes).sort()) ||
    value.gameAdapterSha256 !== binding.gameAdapterSha256 ||
    !isDeepStrictEqual(value.cases, binding.cases)
  )
    throw new Error('Reference scene, input snapshot, game adapter or queries do not match');
  // Algorithm/config/source hashes may differ: comparing those variants is the purpose.
  const rows = value.batch.results.map((row: unknown, index: number) => {
    if (
      !record(row) ||
      typeof row.id !== 'string' ||
      typeof row.status !== 'string' ||
      typeof row.partial !== 'boolean' ||
      (row.cost !== null && typeof row.cost !== 'number')
    )
      throw new Error('Invalid reference result');
    if (row.id !== binding.cases[index]?.id) throw new Error('Reference result/query mismatch');
    return {
      id: row.id,
      status: row.status,
      partial: row.partial,
      cost: row.cost,
      ...(typeof row.outcomeSha256 === 'string' ? { outcomeSha256: row.outcomeSha256 } : {}),
      ...(typeof row.truncated === 'boolean' ? { truncated: row.truncated } : {}),
      ...(typeof row.reason === 'string' || row.reason === null ? { reason: row.reason } : {}),
      ...(typeof row.timedOut === 'boolean' ? { timedOut: row.timedOut } : {}),
      ...(typeof row.wallMs === 'number' ? { wallMs: row.wallMs } : {}),
    };
  });
  if (rows.length !== binding.cases.length) throw new Error('Reference result/query mismatch');
  costs(rows);
  return rows;
}
