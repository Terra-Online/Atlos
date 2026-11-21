import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';

import {
  buildGroundTiles,
  createTileSurfaceCache,
  decodeTileSurfaces,
  encodeTileSurfaces,
  stitchGroundTiles,
  type TileCache,
} from '#@/src/build.ts';
import type { Surface, Vec3 } from '#@/src/geometry.ts';

function gridSurfaces(rows: number, cols: number): Surface[] {
  const surfaces: Surface[] = [];
  let id = 0;
  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) {
      const wx0 = Math.fround(-1024.37 + x * 0.63);
      const wx1 = Math.fround(-1024.37 + (x + 1) * 0.63);
      const wz0 = Math.fround(512.19 + z * 0.63);
      const wz1 = Math.fround(512.19 + (z + 1) * 0.63);
      const y0 = Math.fround(Math.sin(x * 0.3) * Math.cos(z * 0.3));
      const y1 = Math.fround(Math.sin((x + 1) * 0.3) * Math.cos(z * 0.3));
      const y2 = Math.fround(Math.sin((x + 1) * 0.3) * Math.cos((z + 1) * 0.3));
      const y3 = Math.fround(Math.sin(x * 0.3) * Math.cos((z + 1) * 0.3));
      surfaces.push({
        id: `s${id++}`,
        vertices: [
          [wx0, y0, wz0],
          [wx0, y3, wz1],
          [wx1, y2, wz1],
          [wx1, y1, wz0],
        ],
        ...(id % 5 === 0 ? { portals: [0, 2] } : id % 7 === 0 ? { portals: [] } : {}),
      });
    }
  }
  return surfaces;
}

test('GTS1 binary tile codec roundtrips float64 bit-exactly and compresses >= 5x over JSON', () => {
  const sample = gridSurfaces(40, 50); // 2,000 convex quads sharing vertices
  const jsonBytes = Buffer.byteLength(JSON.stringify(sample), 'utf8');

  // Exact float64 roundtrip (including explicit portals, empty portals, and omitted portals).
  const bin64 = encodeTileSurfaces(sample, { precision: 'float64' });
  const decoded64 = decodeTileSurfaces(bin64);
  assert.deepEqual(decoded64, sample);

  // Unaligned slice view still decodes identically.
  const padded = new Uint8Array(bin64.byteLength + 3);
  padded.set(bin64, 3);
  assert.deepEqual(decodeTileSurfaces(padded.subarray(3)), sample);

  // Default float32 mode achieves >= 5x size reduction vs JSON and fast decode.
  const bin32 = encodeTileSurfaces(sample);
  assert.ok(
    bin32.byteLength * 5 < jsonBytes,
    `Expected >= 5x compression: binary=${bin32.byteLength}B, json=${jsonBytes}B`,
  );
  const t0 = performance.now();
  const decoded32 = decodeTileSurfaces(bin32, '3,-2/');
  const decodeMs = performance.now() - t0;
  assert.equal(decoded32.length, sample.length);
  assert.equal(decoded32[0].id, '3,-2/s0');
  assert.ok(decodeMs < 250, `Expected fast binary decode, got ${decodeMs.toFixed(2)}ms`);

  // Empty tiles & malformed buffers.
  assert.deepEqual(decodeTileSurfaces(encodeTileSurfaces([])), []);
  assert.throws(() => decodeTileSurfaces(new Uint8Array(8)), /truncated header/);
  const badMagic = encodeTileSurfaces([]);
  badMagic[0] ^= 0xff;
  assert.throws(() => decodeTileSurfaces(badMagic), /magic/);
});

test('stitchGroundTiles matches buildGroundTiles identically from binary-cached per-tile surfaces', async () => {
  // Two-tier sloped floor spanning a 2x2 grid of 8m tiles.
  const positions: number[] = [];
  const indices: number[] = [];
  const addQuad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => {
    const base = positions.length / 3;
    positions.push(...a, ...b, ...c, ...d);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  addQuad([-1, 0, -1], [-1, 0, 17], [17, 0, 17], [17, 0, -1]);
  const geometry = { positions, indices };

  const buildOptions = {
    profile: { radius: 0.35, height: 1.66 },
    maxSlope: 46,
    stepUp: 0.4,
    stepDown: 0.5,
    cellSize: 0.25,
    cellHeight: 0.1,
    tileCells: 32, // 8m tiles
    bounds: { min: [0, 0] as [number, number], max: [16, 16] as [number, number] },
  };

  // Capture binary-encoded padded tile outputs via TileCache.
  const binaryTiles = new Map<string, { x: number; z: number; bytes: Uint8Array }>();
  const cache: TileCache = {
    async load() {
      return null;
    },
    async save(_geom, opts, surfaces) {
      const tx = Math.floor((opts.bounds!.min[0] + opts.bounds!.max[0]) / 2 / 8);
      const tz = Math.floor((opts.bounds!.min[1] + opts.bounds!.max[1]) / 2 / 8);
      binaryTiles.set(`${tx},${tz}`, {
        x: tx,
        z: tz,
        bytes: encodeTileSurfaces(surfaces, { precision: 'float64' }),
      });
    },
  };

  const built = await buildGroundTiles(geometry, { ...buildOptions, cache });
  assert.equal(binaryTiles.size, 4);

  // Re-stitch all 4 tiles from binary buffers in memory and compare bit-for-bit.
  const stitched = stitchGroundTiles(
    [...binaryTiles.values()].map((tile) => ({
      x: tile.x,
      z: tile.z,
      surfaces: decodeTileSurfaces(tile.bytes),
    })),
    buildOptions,
  );
  assert.deepEqual(stitched, built);
  assert.ok(stitched.portals.length > 0);

  // Sub-window (2 tiles) stitches seamlessly without re-baking.
  const subWindow = stitchGroundTiles(
    ['0,0', '1,0'].map((key) => {
      const tile = binaryTiles.get(key)!;
      return { x: tile.x, z: tile.z, surfaces: decodeTileSurfaces(tile.bytes) };
    }),
    { ...buildOptions, bounds: { min: [0, 0], max: [16, 8] } },
  );
  assert.equal(subWindow.tiles.length, 2);
  assert.ok(subWindow.portals.length > 0);
});

test('createTileSurfaceCache enforces byte-bounded LRU eviction', () => {
  const sample = gridSurfaces(5, 5);
  const cache = createTileSurfaceCache({ maxBytes: 15_000 });
  for (let i = 0; i < 6; i++) cache.set(`t:${i}`, sample);
  const stats = cache.stats();
  assert.ok(stats.bytes <= 15_000);
  assert.ok(stats.evictions > 0);
  assert.equal(cache.get('t:0'), undefined);
  assert.ok(cache.get('t:5'));
});
