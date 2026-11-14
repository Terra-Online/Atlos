import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import type { Episode, CompactDecision } from '#@/scripts/research/collect.ts';
import { type Model, train, rank, probability, checkSplits } from '#@/scripts/research/policy.ts';

const { values } = parseArgs({
  options: {
    input: { type: 'string' },
    output: { type: 'string' },
    weights: { type: 'string' },
    train: { type: 'boolean', default: false },
  },
});
if (!values.input || !values.output)
  throw new Error(
    'Usage: analyze.ts --input <collection> --output <new JSON> [--train --weights <new JSON>]',
  );
const episodes: Episode[] = [],
  inputs: { name: string; sha256: string }[] = [];
for (const name of (await readdir(values.input)).filter((name) => name.endsWith('.jsonl')).sort()) {
  const bytes = await readFile(resolve(values.input, name));
  inputs.push({ name, sha256: createHash('sha256').update(bytes).digest('hex') });
  episodes.push(
    ...bytes
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Episode),
  );
}
const levels = checkSplits(episodes);
let model: Model | undefined;
const started = performance.now();
if (values.train) {
  model = train(episodes.filter((episode) => episode.split === 'train'));
  model.training = {
    elapsedMs: performance.now() - started,
    inputs,
    levels: [...levels].filter(([, split]) => split === 'train').map(([level]) => level),
    scope:
      'tested motion witness after support/collision/walls and direct walking dominance; no whole-route label',
  };
  if (!values.weights) throw new Error('--train requires --weights');
  await writeFile(values.weights, JSON.stringify(model, null, 2), { flag: 'wx' });
} else if (values.weights) model = JSON.parse(await readFile(values.weights, 'utf8')) as Model;

function metrics(rows: CompactDecision[]) {
  const valid = rows.filter((row) => row.valid);
  return {
    candidates: rows.length,
    valid: valid.length,
    found: Boolean(valid.length),
    first: valid.length ? rows.indexOf(valid[0]) + 1 : null,
    bestDuration: valid.length ? Math.min(...valid.map((row) => row.duration!)) : null,
    elapsedMs: rows.reduce((sum, row) => sum + row.elapsedMs, 0),
    sweeps: rows.reduce((sum, row) => sum + row.sweeps, 0),
  };
}
const strata: Record<string, number> = {};
const splits: Record<
  string,
  {
    episodes: number;
    witnesses: number;
    valid: number;
    found: number;
    reasons: Record<string, number>;
    strata: Record<string, number>;
  }
> = {};
const arms: Record<
  string,
  { episodes: number; found: number; validations: number; firstSum: number; firstFound: number }
> = {};
for (const episode of episodes) {
  const key = `${episode.map}/${episode.level}/${episode.split}`;
  const group = (splits[key] ??= {
    episodes: 0,
    witnesses: 0,
    valid: 0,
    found: 0,
    reasons: {},
    strata: {},
  });
  group.episodes++;
  const m = metrics(episode.decisions);
  group.witnesses += m.candidates;
  group.valid += m.valid;
  group.found += Number(m.found);
  group.strata[episode.stratum] = (group.strata[episode.stratum] ?? 0) + 1;
  for (const row of episode.decisions)
    group.reasons[row.reason] = (group.reasons[row.reason] ?? 0) + 1;
  strata[episode.stratum] = (strata[episode.stratum] ?? 0) + 1;
  if (model)
    for (const name of ['reference', 'learned'])
      for (const budget of [4, 8, 16, 32]) {
        const key = `${episode.split}/${name}/${budget}`;
        const row = (arms[key] ??= {
          episodes: 0,
          found: 0,
          validations: 0,
          firstSum: 0,
          firstFound: 0,
        });
        const result = metrics(
          rank(episode.decisions, name === 'learned' ? model : undefined).slice(0, budget),
        );
        row.episodes++;
        row.found += Number(result.found);
        row.validations += result.candidates;
        if (result.found) {
          row.firstSum += result.first!;
          row.firstFound++;
        }
      }
}
const online: Record<
  string,
  {
    episodes: number;
    found: number;
    withFallback: number;
    primaryMs: number;
    fallbackMs: number;
    generationMs: number;
    witnesses: number;
    fallbackWitnesses: number;
    qualityLoss: number;
    coverageLoss: number;
    primaryFirstMs: number;
    fullFirstMs: number;
    prefixes: Record<string, number>;
  }
> = {};
const paired: Record<string, { episodes: number; referenceMs: number; armMs: number }> = {};
for (const episode of episodes.filter(
  (episode): episode is Episode & { arms: NonNullable<Episode['arms']> } => Boolean(episode.arms),
))
  for (const [name, arm] of Object.entries(episode.arms)) {
    const key = `${episode.map}/${name}`;
    const row = (online[key] ??= {
      episodes: 0,
      found: 0,
      withFallback: 0,
      primaryMs: 0,
      fallbackMs: 0,
      generationMs: 0,
      witnesses: 0,
      fallbackWitnesses: 0,
      qualityLoss: 0,
      coverageLoss: 0,
      primaryFirstMs: 0,
      fullFirstMs: 0,
      prefixes: Object.fromEntries([4, 8, 16, 32].map((n) => [n, 0])),
    });
    const primary = metrics(arm.primary),
      full = metrics([...arm.primary, ...arm.fallback]);
    const reference = metrics(episode.arms.reference.primary);
    row.episodes++;
    row.found += Number(primary.found);
    row.withFallback += Number(full.found);
    row.primaryMs += arm.primaryMs;
    row.fallbackMs += arm.fallbackMs;
    row.generationMs += arm.generationMs;
    row.primaryFirstMs += arm.primaryFirstMs ?? 0;
    row.fullFirstMs += arm.fullFirstMs ?? 0;
    row.witnesses += primary.candidates;
    row.fallbackWitnesses += arm.fallback.length;
    row.coverageLoss += Number(reference.found && !full.found);
    row.qualityLoss += Number(
      reference.found && (!full.found || full.bestDuration! > reference.bestDuration! + 1e-9),
    );
    for (const budget of [4, 8, 16, 32])
      row.prefixes[budget] += Number(metrics(arm.primary.slice(0, budget)).found);
    const referenceArm = episode.arms.reference;
    for (const [label, field] of [
      ['primary', 'primaryFirstMs'],
      ['fallback', 'fullFirstMs'],
    ] as const) {
      if (arm[field] === null || referenceArm[field] === null) continue;
      const comparison = (paired[`${name}/${label}`] ??= { episodes: 0, referenceMs: 0, armMs: 0 });
      comparison.episodes++;
      comparison.referenceMs += referenceArm[field]! + referenceArm.generationMs;
      comparison.armMs += arm[field]! + arm.generationMs;
    }
  }
let calibration: Record<string, { rows: number; brier: number | null }> | undefined;
if (model) {
  calibration = {};
  for (const split of ['train', 'validation', 'test']) {
    const rows = episodes
      .filter((episode) => episode.split === split)
      .flatMap((episode) => episode.decisions);
    calibration[split] = {
      rows: rows.length,
      brier: rows.length
        ? rows.reduce(
            (sum, row) => sum + (probability(model!, row.features) - Number(row.valid)) ** 2,
            0,
          ) / rows.length
        : null,
    };
  }
}
const featureAblation: Record<
  string,
  { episodes: number; found: number; wins: number; losses: number }
> = {};
if (values.train) {
  const training = episodes.filter((episode) => episode.split === 'train');
  // Duration and reach ratio also depend on jump/drop selection. Remove those
  // proxies with the explicit control fields for the geometry-only ablation.
  const models = {
    full: model!,
    geometryOnly: train(training, 250, [3, 4, 9, 10]),
    controlOnly: train(
      training,
      250,
      Array.from({ length: 9 }, (_, i) => i),
    ),
  };
  for (const [name, fitted] of Object.entries(models))
    for (const split of ['validation', 'test'])
      for (const budget of [4, 8, 16]) {
        const row = { episodes: 0, found: 0, wins: 0, losses: 0 };
        for (const episode of episodes.filter((episode) => episode.split === split)) {
          const candidate = metrics(rank(episode.decisions, fitted).slice(0, budget));
          const reference = metrics(rank(episode.decisions).slice(0, budget));
          row.episodes++;
          row.found += Number(candidate.found);
          row.wins += Number(candidate.found && !reference.found);
          row.losses += Number(reference.found && !candidate.found);
        }
        featureAblation[`${split}/${name}/${budget}`] = row;
      }
}
await writeFile(
  values.output,
  JSON.stringify(
    {
      scope: 'local useful motion discovery; not complete routes or current solver speed',
      episodes: episodes.length,
      inputs,
      splits,
      strata,
      replay: arms,
      online,
      paired,
      calibration,
      featureAblation,
      trainingMs: model?.training?.elapsedMs,
    },
    null,
    2,
  ),
  { flag: 'wx' },
);
console.log(
  JSON.stringify({
    episodes: episodes.length,
    splits,
    online,
    trainingMs: model?.training?.elapsedMs,
  }),
);
