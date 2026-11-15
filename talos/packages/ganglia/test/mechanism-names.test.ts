import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// oxlint-disable-next-line no-restricted-imports -- fixture IDs must use the application's canonical codec instead of a copied implementation
import {
  encodePointIdToken,
  decodePointIdToken,
} from '../../../src/services/routing/pointToken.ts';

const directory = new URL('../bench/scenes/mechanisms/', import.meta.url);
const read = async (name: string) => JSON.parse(await readFile(new URL(name, directory), 'utf8'));
test('all main cases use their real source token and preserve the original regression tokens', async () => {
  const suite = await read('suite.json');
  assert.equal(suite.cases.length, 266);
  for (const [i, c] of suite.cases.entries()) {
    const token = encodePointIdToken(c.tokenSourceId);
    assert.ok(token);
    assert.equal(token.length, 7);
    assert.equal(c.id, `${String(i + 1).padStart(3, '0')}-${token}`);
    assert.equal(decodePointIdToken(token), c.tokenSourceId);
    if (c.legacyToken) assert.equal(token, c.legacyToken);
    assert.notEqual(c.target.kind, 'navigation-contact');
    assert.equal(
      c.tokenSourceId,
      c.target.id.startsWith('conveyor/') ? c.target.id.split('/')[1] : c.target.id,
    );
  }
  assert.equal(suite.cases.filter((c: { legacyToken?: string }) => c.legacyToken).length, 113);
});
test('geometry queries remain separate and coverage references neither lose them nor invent map tokens', async () => {
  const suite = await read('suite.json'),
    geometry = await read('geometry-probes.json'),
    coverage = await read('coverage.json');
  assert.equal(geometry.cases.length, 6);
  const cases = new Set(suite.cases.map((c: { id: string }) => c.id)),
    probes = new Set(geometry.cases.map((c: { id: string }) => c.id));
  for (const probe of geometry.cases) {
    assert.equal(probe.target.kind, 'navigation-contact');
    assert.equal(probe.pointToken, undefined);
    const c = suite.cases.find(
      (c: { legacyCaseId: string }) => c.legacyCaseId === probe.legacyCaseId,
    );
    assert.ok(c);
    assert.deepEqual(c.query.starts, probe.query.starts);
    assert.deepEqual(c.replacement.originalGoal, probe.query.goal);
    assert.equal(c.geometryProbe.id, probe.id);
    assert.equal(c.target.kind, 'interactive');
    assert.ok(c.replacement.verticalDifferenceM <= 1);
    if (c.replacement.horizontalDistanceM > 30)
      assert.equal(c.replacement.relation, 'new-navigation-case-not-equivalent-nearby-replacement');
  }
  for (const entry of coverage.mechanisms) {
    assert.ok(entry.selectedCases.every((id: string) => cases.has(id)));
    assert.ok((entry.geometryProbeIds ?? []).every((id: string) => probes.has(id)));
  }
  const map = (await readFile(new URL('legacy-id-map.csv', directory), 'utf8')).trim().split('\n');
  assert.equal(map.length, 267);
  assert.equal(new Set(map.slice(1).map((row) => row.split(',')[1])).size, 266);
});
