import assert from 'node:assert/strict';
import { test } from 'node:test';

import { benchmarkMarkdown } from '#@/bench/markdown.ts';
import {
  compareQuality,
  readReference,
  qualityGate,
  summarizeQuality,
  type QualityRow,
} from '#@/bench/quality.ts';
import { gangliaV1Defaults } from '#@/src/solver/index.ts';

const row = (id: string, cost: number, partial = false): QualityRow => ({
  id,
  cost,
  partial,
  status: 'complete',
});

test('quality gates reject lost routes, excessive individual cost and unstable warm results', () => {
  const stable = { sameOutcomeAsPrewarm: true, sameTruncationAsPrewarm: true };
  const check = (rows: QualityRow[], before: QualityRow[]) =>
    qualityGate(
      rows.map((r) => ({ ...r, ...stable })),
      compareQuality(rows, before),
    );
  const before = [row('short', 1), row('long', 100)];
  assert.equal(check([row('short', 1.02), row('long', 98)], before).passed, true);
  assert.equal(check([row('short', 1.06), row('long', 90)], before).passed, false);
  assert.equal(check([row('short', 1.02), row('long', 102)], before).passed, false);
  assert.equal(check([row('short', 1), row('long', 0, true)], before).passed, false);
  assert.equal(check([row('short', 1)], [row('short', 0)]).passed, false);
  assert.equal(
    qualityGate([{ ...row('one', 1), ...stable, sameTruncationAsPrewarm: false }], undefined)
      .passed,
    false,
  );
});
test('modeled time distinguishes quality without favoring missing or partial solutions', () => {
  const rows = [row('short', 2), row('long', 20)];
  assert.equal(summarizeQuality(rows).totalCostSeconds, 22);
  const incomplete = summarizeQuality([rows[0], row('long', 0.1, true)]);
  assert.equal(incomplete.totalCostSeconds, null);
  assert.equal(incomplete.completed, 1);
  assert.equal(incomplete.completionRate, 0.5);
  assert.throws(() => summarizeQuality([row('broken', NaN)]), /Invalid modeled route cost/);
});

test('timeouts and late complete routes fail the SLO without contributing modeled quality cost', () => {
  const rows = [
    { ...row('on-time', 4), wallMs: 300_000 },
    { ...row('late', 1), wallMs: 300_001 },
    { ...row('deadline', 0), status: 'no-verified-route' as const, reason: 'timeout' },
  ];
  const quality = summarizeQuality(rows);
  assert.equal(quality.completed, 1);
  assert.equal(quality.sloCompleted, 1);
  assert.equal(quality.timedOut, 2);
  assert.equal(quality.failed, 2);
  assert.equal(quality.totalCostSeconds, null);
  assert.equal(quality.meanCompletedCostSeconds, 4);
  assert.equal(
    qualityGate(
      rows.map((r) => ({ ...r, sameOutcomeAsPrewarm: true, sameTruncationAsPrewarm: true })),
      undefined,
    ).passed,
    false,
  );
});

test('recovering timed-out routes gains solutions while common routes retain cost gates', () => {
  const before = [
    { ...row('timeout', 0), status: 'no-verified-route' as const, reason: 'timeout' },
    { ...row('failed', 0), status: 'no-verified-route' as const },
    row('existing', 10),
  ];
  const current = [row('timeout', 15), row('failed', 20), row('existing', 10.6)];
  const comparison = compareQuality(current, before);
  assert.deepEqual(comparison.gainedSolutions, ['timeout', 'failed']);
  assert.deepEqual(comparison.recoveredTimeouts, ['timeout']);
  assert.equal(comparison.referenceTimedOut, 1);
  assert.equal(comparison.pairedCompleted, 1);
  assert.equal(comparison.worstCostRatio, 1.06);
  assert.equal(
    qualityGate(
      current.map((r) => ({ ...r, sameOutcomeAsPrewarm: true, sameTruncationAsPrewarm: true })),
      comparison,
    ).passed,
    false,
  );
  const lost = compareQuality([{ ...row('existing', 0), timedOut: true }], [row('existing', 10)]);
  assert.deepEqual(lost.lostSolutions, ['existing']);
  assert.equal(lost.pairedCompleted, 0);
});

test('markdown exposes timeout failures and successful throughput without claiming failure as speedup', () => {
  const measured = [
    { ...row('one', 0), status: 'no-verified-route' as const, reason: 'timeout', timedOut: true },
  ];
  const markdown = benchmarkMarkdown({
    scene: 'fixture',
    revision: '1234567',
    sourceSha256: 'source',
    node: 'test',
    concurrency: 1,
    execution: { mode: 'serial', workers: 0, lanes: 1 },
    config: gangliaV1Defaults,
    querySloMs: 300_000,
    prewarmMs: 1,
    prewarmRecoverySetupMs: 0,
    prewarmQuality: summarizeQuality(measured),
    batch: {
      rounds: 1,
      wallSamplesMs: [300_000],
      totalWallMs: 300_000,
      wallMs: 300_000,
      recoverySetupMs: 0,
      samples: [],
      successfulQueries: 0,
      timedOutAttempts: 1,
      successfulQueriesPerSecond: 0,
      queriesPerSecond: 1 / 300,
      meanSerialQueryMs: 300_000,
      quality: summarizeQuality(measured),
      results: measured.map((r) => ({
        ...r,
        partial: false,
        cost: null,
        length: null,
        jumps: 0,
        drops: 0,
        truncated: true,
        outcomeSha256: 'timeout',
        wallSamplesMs: [300_000],
        sameOutcomeAsPrewarm: true,
        sameTruncationAsPrewarm: true,
      })),
    },
    comparison: { ...compareQuality(measured, [row('one', 10)]), speedup: 20 },
  });
  assert.match(markdown, /Successful throughput \| 0\.000 complete routes\/s/);
  assert.match(markdown, /Timed-out queries \| 1\/1/);
  assert.match(markdown, /Lost \/ gained solutions \| 1 \/ 0/);
  assert.match(markdown, /Speedup vs reference \| n\/a/);
  assert.doesNotMatch(markdown, /20\.000×/);
  assert.match(markdown, /\| one \| timeout \| n\/a \|/);
});

test('reference comparison pairs by id, weighs queries equally and exposes individual regressions', () => {
  const comparison = compareQuality(
    [row('long', 50), row('short', 2)],
    [row('short', 1), row('long', 100)],
  );
  assert.equal(comparison.geometricMeanCostRatio, 1);
  assert.equal(comparison.worstCostRatio, 2);
  assert.deepEqual(
    comparison.pairs.map((r) => r.deltaSeconds),
    [-50, 1],
  );
  assert.deepEqual(comparison.lostSolutions, []);
  const lost = compareQuality(
    [row('short', 0.1), row('long', 1, true)],
    [row('short', 1), row('long', 100)],
  );
  assert.deepEqual(lost.lostSolutions, ['long']);
  assert.equal(lost.pairedCompleted, 1);
  assert.throws(() => compareQuality([row('other', 1)], [row('short', 1)]), /query ids/);
});

test('zero-time reference routes cannot silently disappear from cost comparisons', () => {
  const equal = compareQuality([row('already-there', 0)], [row('already-there', 0)]);
  assert.equal(equal.geometricMeanCostRatio, 1);
  const slower = compareQuality([row('already-there', 1)], [row('already-there', 0)]);
  assert.equal(slower.geometricMeanCostRatio, null);
  assert.equal(slower.unboundedCostRegressions, 1);
  assert.equal(slower.pairs[0].deltaSeconds, 1);
});

test('references bind the same problem and data while allowing algorithm/config changes and relocated files', () => {
  const binding = {
    scene: 'fixture',
    source: { build: 'game-build' },
    hashes: { '/current/ground.json': 'abc' },
    gameAdapterSha256: 'adapter',
    cases: [{ id: 'one', query: { starts: [], goal: [1, 0, 0] as [number, number, number] } }],
  };
  const reference = {
    ...binding,
    hashes: { '/old/ground.json': 'abc' },
    config: { algorithm: 'other' },
    batch: { results: [row('one', 2)] },
  };
  assert.deepEqual(readReference(reference, binding), [row('one', 2)]);
  const timedReference = readReference(
    {
      ...reference,
      batch: {
        results: [{ ...row('one', 2), reason: 'timeout', timedOut: true, wallMs: 300_001 }],
      },
    },
    binding,
  );
  assert.equal(summarizeQuality(timedReference).completed, 0);
  assert.deepEqual(compareQuality([row('one', 2)], timedReference).recoveredTimeouts, ['one']);
  assert.throws(
    () => readReference({ ...reference, hashes: { ground: 'changed' } }, binding),
    /do not match/,
  );
  assert.throws(() => readReference({ ...reference, cases: [] }, binding), /do not match/);
  assert.throws(
    () => readReference({ ...reference, batch: { results: [row('different', 2)] } }, binding),
    /result\/query mismatch/,
  );
});
