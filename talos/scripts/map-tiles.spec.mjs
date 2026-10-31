import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { selectTileZoom } from './seo/tiles.mjs';

test('OG uses Dijiang native level three independently of its level-two coordinate basis', async () => {
    const regions = JSON.parse(await readFile(new URL('../src/data/map/region.json', import.meta.url), 'utf8'));
    const coverage = JSON.parse(await readFile(new URL('../src/data/map/tileCoverage.json', import.meta.url), 'utf8'));
    assert.equal(regions.Dijiang.coordZoom, 2);
    assert.equal(selectTileZoom({ zooms: coverage.regions.Dijiang }), 3);
});

test('OG chooses a populated common surface/floor level without inventing a capped level', () => {
    const rows = { '-1': [-2, 0] };
    const coverage = { zooms: { '0': { '': rows }, '2': { '': rows, _b1: rows },
        '3': { '': rows, _b1: {} }, '4': { '': rows } } };
    assert.equal(selectTileZoom(coverage), 3);
    assert.equal(selectTileZoom(coverage, '_b1'), 2);
    assert.equal(selectTileZoom(coverage, '_l1'), 3);
    delete coverage.zooms['3'];
    assert.equal(selectTileZoom(coverage), 2);
    assert.throws(() => selectTileZoom({ zooms: { '0': { '': rows }, '1': { _b1: rows } } }, '_b1'),
        /No common OG tile level/);
});
