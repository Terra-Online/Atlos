export interface Model {
  features: string[];
  mean: number[];
  scale: number[];
  weights: number[];
  bias: number;
  rows: number;
  training?: {
    elapsedMs: number;
    inputs: { name: string; sha256: string }[];
    levels: string[];
    scope: string;
  };
}
export interface FeatureRow {
  features: number[];
  valid?: boolean | null;
}
// Research-only scheduling. Scores are never admissible bounds or rejection evidence.
export const featureNames = [
  'span',
  'rise',
  'absRise',
  'duration',
  'reachRatio',
  'sourceArea',
  'targetArea',
  'sourceEdge',
  'targetEdge',
  'drop',
  'split',
];

export function checkSplits(episodes: readonly { map: string; level: string; split: string }[]) {
  const levels = new Map();
  for (const episode of episodes) {
    const key = `${episode.map}/${episode.level}`;
    if (levels.has(key) && levels.get(key) !== episode.split)
      throw new Error(`Level leaks across splits: ${key}`);
    levels.set(key, episode.split);
  }
  return levels;
}

export function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function probability(model: Model, features: number[]) {
  const score = model.weights.reduce(
    (sum, weight, index) =>
      sum + (weight * (features[index] - model.mean[index])) / model.scale[index],
    model.bias,
  );
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, score))));
}

/** Only individually tested witnesses have labels. An unresolved episode is not a negative. */
export function train(
  episodes: readonly { decisions: FeatureRow[]; unresolved?: boolean }[],
  iterations = 250,
  excluded: number[] = [],
) {
  const rows = episodes
    .flatMap((episode) => episode.decisions)
    .filter((row) => typeof row.valid === 'boolean');
  if (!rows.length || !rows.some((row) => row.valid) || !rows.some((row) => !row.valid))
    throw new Error('Training needs tested positive and negative witnesses');
  const count = featureNames.length;
  const mean = Array.from(
    { length: count },
    (_, i) => rows.reduce((sum, row) => sum + row.features[i], 0) / rows.length,
  );
  const scale = mean.map((value, i) =>
    Math.max(
      1e-3,
      Math.sqrt(rows.reduce((sum, row) => sum + (row.features[i] - value) ** 2, 0) / rows.length),
    ),
  );
  const model: Model = {
    features: featureNames,
    mean,
    scale,
    weights: Array<number>(count).fill(0),
    bias: 0,
    rows: rows.length,
  };
  const inputs = rows.map((row) => row.features.map((value, i) => (value - mean[i]) / scale[i]));
  for (let step = 0; step < iterations; step++) {
    const gradient = Array<number>(count).fill(0);
    let bias = 0;
    for (let row = 0; row < rows.length; row++) {
      const x = inputs[row];
      const score = model.weights.reduce((sum, weight, i) => sum + weight * x[i], model.bias);
      const error =
        1 / (1 + Math.exp(-Math.max(-30, Math.min(30, score)))) - Number(rows[row].valid);
      bias += error;
      for (let i = 0; i < count; i++) gradient[i] += error * x[i];
    }
    model.bias -= (0.15 * bias) / rows.length;
    for (let i = 0; i < count; i++)
      if (!excluded.includes(i))
        model.weights[i] -= 0.15 * (gradient[i] / rows.length + 0.001 * model.weights[i]);
  }
  return model;
}

export function rank<T extends { features: number[]; heuristic?: number }>(
  candidates: readonly T[],
  model?: Model,
) {
  // Compute inference once per candidate, not inside the sort comparator.
  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: model ? probability(model, candidate.features) : -candidate.heuristic!,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.candidate);
}

/** Diagonal CEM over four endpoint coordinates. Each generation reserves uniform
 * exploration; a failed search leaves the original candidate queue available.
 * This is basic CEM, not the temporal/noise/memory algorithm described as iCEM.
 */
export function crossEntropy<
  C extends { vector: number[]; features: number[]; heuristic: number },
  R extends C & { valid: boolean; duration?: number | null },
>({
  rng,
  propose,
  evaluate,
  model,
  budget = 32,
  population = 8,
}: {
  rng: () => number;
  propose: (vector: number[], ordinal: number) => C;
  evaluate: (candidate: C) => R;
  model?: Model;
  budget?: number;
  population?: number;
}) {
  let mean = [0.5, 0.5, 0.5, 0.5],
    deviation = [0.3, 0.3, 0.3, 0.3];
  const results: R[] = [];
  const normal = () =>
    Math.sqrt(-2 * Math.log(Math.max(Number.EPSILON, rng()))) * Math.cos(2 * Math.PI * rng());
  while (results.length < budget) {
    const candidates: C[] = [];
    const count = Math.min(population, budget - results.length);
    for (let index = 0; index < count; index++) {
      const vector = mean.map((value, axis) =>
        index % 4 === 0 ? rng() : Math.max(0, Math.min(1, value + deviation[axis] * normal())),
      );
      candidates.push(propose(vector, results.length + index));
    }
    const generation = rank(candidates, model).map((candidate) => evaluate(candidate));
    results.push(...generation);
    const elite = [...generation]
      .sort(
        (a, b) =>
          Number(b.valid) - Number(a.valid) ||
          (a.valid ? a.duration! - b.duration! : a.heuristic - b.heuristic),
      )
      .slice(0, Math.max(2, Math.ceil(count / 4)));
    mean = mean.map(
      (value, axis) =>
        0.3 * value + (0.7 * elite.reduce((sum, row) => sum + row.vector[axis], 0)) / elite.length,
    );
    deviation = deviation.map((value, axis) =>
      Math.max(
        0.08,
        0.3 * value +
          0.7 *
            Math.sqrt(
              elite.reduce((sum, row) => sum + (row.vector[axis] - mean[axis]) ** 2, 0) /
                elite.length,
            ),
      ),
    );
  }
  return results;
}

// A fallback must traverse every original representative, including after a miss.
export function withFallback<A extends { id: string }, B extends { id: string }>(
  primary: readonly A[],
  baseline: readonly B[],
) {
  const seen = new Set(primary.map((row) => row.id));
  return [...primary, ...baseline.filter((row) => !seen.has(row.id))];
}
