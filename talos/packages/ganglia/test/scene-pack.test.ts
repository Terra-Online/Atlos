import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { openSceneLoader } from '#@/bench/scene-data/loader.ts';
import {
  manifestName,
  writeScenePack,
  type CollisionExport,
  type Manifest,
} from '#@/src/scene-pack.ts';

const source = { buildGuid: 'build', contentHash: 'content' };
const settings = {
  profile: { radius: 0.3, height: 1.6 },
  maxSlope: 45,
  stepUp: 0.4,
  stepDown: 0.4,
  cellSize: 0.15,
  cellHeight: 0.05,
  tileCells: 256,
};
const tile = (x: number) => ({
  x,
  z: 0,
  surfaces: [
    {
      id: String(x),
      vertices: [
        [x * 38.4, 0, 0],
        [x * 38.4, 0, 38.4],
        [(x + 1) * 38.4, 0, 38.4],
        [(x + 1) * 38.4, 0, 0],
      ] as [number, number, number][],
    },
  ],
});
const collision: CollisionExport = {
  positions: [0, 0, 0, 150, 0, 0, 0, 0, 20],
  indices: [0, 2, 1],
  records: [{ id: 7, first: 0, count: 1, bounds: { min: [0, 0, 0], max: [150, 0, 20] } }],
  coverage: {},
  exclusions: [],
};
const pack = (root: string) =>
  writeScenePack(root, { scene: 'example', source, selection: {}, settings }, async (append) => {
    await append(collision, [tile(0), tile(1)]);
    await append(collision, [tile(2), tile(3)]);
  });

test('loads shared collision once and rebuilds ground portals for the selected tiles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ganglia-scene-pack-'));
  try {
    await pack(root);
    const loader = await openSceneLoader(root, 'example', source, 1024 * 1024);
    try {
      await loader.withWindow({ min: [2, 1], max: [72, 35] }, undefined, (snapshot) => {
        assert.deepEqual([...snapshot.collision.indices], [0, 2, 1]);
        assert.equal(snapshot.ground.surfaces.length, 2);
        assert.equal(snapshot.ground.portals.length, 2);
        assert.equal(Math.min(...snapshot.ground.surfaces[0].vertices.map((v) => v[0])), 2);
      });
      const before = loader.stats();
      await loader.withWindow({ min: [120, 1], max: [140, 19] }, undefined, (snapshot) => {
        assert.equal(snapshot.collision.records.length, 1);
        assert.equal(snapshot.ground.portals.length, 0);
      });
      assert.equal(loader.stats().collisionReads, before.collisionReads);
    } finally {
      await loader.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('evicts idle ground blocks under a byte budget and recovers from cancelled work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ganglia-scene-budget-'));
  const left = { min: [2, 1], max: [34, 30] } as const;
  const right = { min: [120, 1], max: [140, 19] } as const;
  try {
    await pack(root);
    const example = await openSceneLoader(root, 'example', source, 1024 * 1024);
    const leftWindow = { min: [...left.min], max: [...left.max] } as Parameters<
      typeof example.withWindow
    >[0];
    const rightWindow = { min: [...right.min], max: [...right.max] } as Parameters<
      typeof example.withWindow
    >[0];
    await example.withWindow(leftWindow, undefined, () => {});
    const limit = example.stats().peakReservedBytes + 32;
    await example.close();

    const loader = await openSceneLoader(root, 'example', source, limit);
    try {
      const [release, releaseSecond, releaseGround] = await loader.withWindow(
        leftWindow,
        undefined,
        (window) => [window.retain(), window.retain(), window.retain('ground')],
      );
      const first = loader.stats();
      await assert.rejects(
        loader.withWindow(rightWindow, undefined, () => assert.fail()),
        /memory budget/,
      );
      release();
      assert.equal(loader.stats().retainedBytes, first.retainedBytes);
      releaseSecond();
      assert.ok(loader.stats().retainedBytes > 0);
      assert.ok(loader.stats().retainedBytes < first.retainedBytes);
      releaseGround();
      assert.equal(loader.stats().retainedBytes, 0);
      const abort = new AbortController();
      abort.abort();
      await assert.rejects(
        loader.withWindow(rightWindow, abort.signal, () => assert.fail()),
        {
          name: 'AbortError',
        },
      );
      assert.equal(loader.stats().readBytes, first.readBytes);
      await loader.withWindow(rightWindow, undefined, () => {});
      assert.equal(loader.stats().collisionReads, first.collisionReads);
      const second = loader.stats().reads;
      await loader.withWindow(leftWindow, undefined, () => {});
      assert.equal(loader.stats().reads, second + 1);
      assert.ok(loader.stats().peakReservedBytes <= limit);
    } finally {
      await loader.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects overlapping block descriptors before admitting any window', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ganglia-scene-index-'));
  try {
    await pack(root);
    const path = join(root, manifestName);
    const manifest = JSON.parse(await readFile(path, 'utf8')) as Manifest;
    manifest.tiles['1,0'].offset = manifest.tiles['0,0'].offset;
    await writeFile(path, JSON.stringify(manifest));
    await assert.rejects(openSceneLoader(root, 'example', source, 1024 * 1024), /block index/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('binds facility receipts to observed geometry with a compound source ID', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ganglia-scene-support-'));
  const receipt = { id: '263170:25', model: 'fixture', pose: 'authored-rest' };
  const support = {
    ...receipt,
    positions: collision.positions,
    indices: collision.indices,
  };
  const otherReceipt = { ...receipt, id: '263170:26' };
  const missing = { ...support, ...otherReceipt, positions: [0, 1, 0, 150, 0, 0, 0, 0, 20] };
  try {
    await writeScenePack(root, { scene: 'example', source, selection: {}, settings }, (append) =>
      append(
        {
          ...collision,
          records: collision.records.map((record) => ({ ...record, id: Number(receipt.id) })),
          coverage: { staticSupports: [receipt, otherReceipt] },
        },
        [tile(0), tile(1), tile(2), tile(3)],
      ),
    );
    const loader = await openSceneLoader(root, 'example', source, 1024 * 1024, [support, missing]);
    try {
      await loader.withWindow({ min: [2, 1], max: [34, 20] }, undefined, (window) => {
        assert.deepEqual(window.collision.coverage.staticSupports, [receipt]);
      });
      await loader.withWindow({ min: [2, 28], max: [34, 35] }, undefined, (window) => {
        assert.deepEqual(window.collision.coverage.staticSupports, []);
      });
    } finally {
      await loader.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
