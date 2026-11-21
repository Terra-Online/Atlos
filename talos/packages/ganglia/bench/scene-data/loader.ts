import { open, readFile, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { deserialize } from 'node:v8';

import { assembleGroundTiles } from '#@/src/build.ts';
import type { Vec3 } from '#@/src/geometry.ts';
import {
  type Block,
  type Bounds,
  collisionCellSpan,
  collisionMesh,
  collisionMeshDigest,
  collisionName,
  gridTiles,
  groundName,
  type GroundTile,
  type Manifest,
  manifestName,
  type Shape,
  sha256,
  type Source,
  type StaticSupport,
  type StaticSupportMesh,
  type Tile,
  tileKey,
} from '#@/src/scene-pack.ts';

export type Window = Bounds & { tiles?: readonly Tile[] };

function intersects(min: Vec3, max: Vec3, bounds: Bounds) {
  return (
    max[0] >= bounds.min[0] &&
    min[0] <= bounds.max[0] &&
    max[2] >= bounds.min[1] &&
    min[2] <= bounds.max[1]
  );
}

export async function openSceneLoader(
  root: string,
  scene: string,
  source: Source,
  budget: number,
  supports: readonly StaticSupportMesh[] = [],
) {
  if (!Number.isSafeInteger(budget) || budget <= 0) throw new Error('Invalid scene loader budget');
  const path = join(root, manifestName);
  const bytes = await readFile(path);
  const manifest = JSON.parse(bytes.toString()) as Manifest;
  if (manifest.scene !== scene || !isDeepStrictEqual(manifest.source, source))
    throw new Error(`Physical pack source mismatch: ${path}`);
  const digest = sha256(bytes);
  const { settings } = manifest;
  const span = settings.cellSize * settings.tileCells;
  if (!Number.isFinite(span) || span <= 0) throw new Error(`Invalid physical tile span: ${path}`);
  const paths = { collision: join(root, collisionName), ground: join(root, groundName) };
  const sizes = {
    collision: (await stat(paths.collision)).size,
    ground: (await stat(paths.ground)).size,
  };
  type Kind = keyof typeof paths;
  type Request = { kind: Kind; block: Block; charge: number };
  const validate = (block: Block, size: number) =>
    Number.isSafeInteger(block.offset) &&
    Number.isSafeInteger(block.length) &&
    block.offset >= 0 &&
    block.length > 0 &&
    block.offset + block.length <= size &&
    /^[0-9a-f]{64}$/.test(block.sha256);
  const validRanges = (blocks: readonly Block[], size: number) => {
    let end = 0;
    for (const block of [...blocks].sort((a, b) => a.offset - b.offset)) {
      if (!validate(block, size) || block.offset < end) return false;
      end = block.offset + block.length;
    }
    return true;
  };
  if (
    !validRanges(manifest.collisionBlocks, sizes.collision) ||
    !validRanges(Object.values(manifest.tiles), sizes.ground) ||
    !Object.values(manifest.cells).every((ids) =>
      ids.every((id) => Number.isInteger(id) && manifest.collisionBlocks[id]),
    )
  )
    throw new Error(`Invalid physical block index: ${path}`);
  const receipts = new Map(manifest.staticSupports.map((support) => [support.id, support]));
  const facilities = new Map<string, StaticSupport[]>();
  const meshSizes = new Set<string>();
  const meshSize = ({ positions, indices }: Pick<Shape, 'positions' | 'indices'>) =>
    `${positions.length}:${indices.length}`;
  for (const support of supports) {
    const receipt = receipts.get(support.id);
    if (!receipt || !support.indices.length) continue;
    const mesh = collisionMesh(support, 0, support.indices.length / 3);
    const hash = collisionMeshDigest(mesh);
    const matches = facilities.get(hash) ?? [];
    matches.push(receipt);
    facilities.set(hash, matches);
    meshSizes.add(meshSize(mesh));
  }
  // Facility IDs can be compound strings. The collision export may have no
  // numeric ID for them, so bind receipts to the actual selected support mesh.
  const facilityEvidence = new WeakMap<Shape, readonly StaticSupport[]>();
  function findFacilities(shape: Shape) {
    if (!meshSizes.has(meshSize(shape))) return [];
    const cached = facilityEvidence.get(shape);
    if (cached) return cached;
    const matches = facilities.get(collisionMeshDigest(shape)) ?? [];
    facilityEvidence.set(shape, matches);
    return matches;
  }
  const files: Partial<Record<Kind, FileHandle>> = {};
  const cache = new Map<string, { value: unknown; bytes: number }>();
  let retained = 0;
  let resident = 0,
    peak = 0,
    reads = 0,
    collisionReads = 0,
    readBytes = 0;
  let closed = false;
  let tail = Promise.resolve();

  let rangeReads = 0;
  let ioMs = 0;
  let decodeMs = 0;
  let assemblyMs = 0;
  const cacheKey = ({ kind, block }: Request) => `${kind}:${block.offset}`;

  async function loadMissing(requests: Request[], signal?: AbortSignal) {
    for (const kind of ['collision', 'ground'] as const) {
      const missing = requests
        .filter((request) => request.kind === kind && !cache.has(cacheKey(request)))
        .sort((a, b) => a.block.offset - b.block.offset);
      for (let first = 0; first < missing.length;) {
        signal?.throwIfAborted();
        const start = missing[first].block.offset;
        let length = missing[first].block.length;
        let end = first + 1;
        while (end < missing.length) {
          const { offset, length: next } = missing[end].block;
          if (offset !== start + length || length + next > 8 * 1024 ** 2) break;
          length += next;
          end++;
        }
        const ioStarted = performance.now();
        const file = (files[kind] ??= await open(paths[kind], 'r'));
        const buffer = Buffer.allocUnsafe(length);
        let offset = 0;
        while (offset < buffer.length) {
          const { bytesRead } = await file.read(
            buffer,
            offset,
            buffer.length - offset,
            start + offset,
          );
          if (!bytesRead)
            throw new Error(`Truncated physical block: ${paths[kind]}@${start + offset}`);
          offset += bytesRead;
        }
        ioMs += performance.now() - ioStarted;
        rangeReads++;
        readBytes += length;
        const decodeStarted = performance.now();
        for (const request of missing.slice(first, end)) {
          signal?.throwIfAborted();
          const { block, charge } = request;
          const bytes = buffer.subarray(block.offset - start, block.offset - start + block.length);
          if (sha256(bytes) !== block.sha256)
            throw new Error(`Physical block digest mismatch: ${paths[kind]}@${block.offset}`);
          cache.set(cacheKey(request), { value: deserialize(bytes), bytes: charge });
          resident += charge;
          reads++;
          if (kind === 'collision') collisionReads++;
        }
        decodeMs += performance.now() - decodeStarted;
        first = end;
      }
    }
  }

  const tilesFor = (window: Window) => {
    if (
      !window.min.every(
        (n, i) => Number.isFinite(n) && Number.isFinite(window.max[i]) && n < window.max[i],
      )
    )
      throw new Error('Invalid physical window bounds');
    if (!window.tiles?.length) {
      const nx = Math.ceil(window.max[0] / span) - Math.floor(window.min[0] / span);
      const nz = Math.ceil(window.max[1] / span) - Math.floor(window.min[1] / span);
      if (nx * nz > 512) throw new Error('Physical window exceeds the 512 tile limit');
    }
    const tiles = window.tiles?.length ? [...window.tiles] : gridTiles(window, span);
    if (
      tiles.length > 512 ||
      new Set(tiles.map(tileKey)).size !== tiles.length ||
      !tiles.every(
        ({ x, z }) =>
          Number.isSafeInteger(x) &&
          Number.isSafeInteger(z) &&
          x * span < window.max[0] &&
          (x + 1) * span > window.min[0] &&
          z * span < window.max[1] &&
          (z + 1) * span > window.min[1],
      )
    )
      throw new Error('Invalid physical window tile selection');
    return tiles.sort((a, b) => a.z - b.z || a.x - b.x);
  };

  const describe = (window: Window) => {
    const tiles = tilesFor(window);
    if (tiles.some((tile) => !Object.hasOwn(manifest.tiles, tileKey(tile))))
      throw new Error(`Missing physical pack coverage in ${scene}: ${JSON.stringify(window)}`);
    const bounds = { min: [...window.min] as Bounds['min'], max: [...window.max] as Bounds['max'] };
    return {
      bounds,
      tiles,
      revision: sha256(Buffer.from(JSON.stringify([digest, bounds, tiles]))),
    };
  };

  async function prepare(
    window: ReturnType<typeof describe>,
    held: number,
    signal: AbortSignal | undefined,
    groundOnly: boolean,
  ) {
    const { bounds, tiles, revision } = window;
    // Search and independent replay may test the capsule just beyond the core.
    const halo = Math.max(2, settings.profile.radius * 2);
    const pad = ({ min, max }: Bounds): Bounds => ({
      min: [min[0] - halo, min[1] - halo],
      max: [max[0] + halo, max[1] + halo],
    });
    const padded = pad(bounds);
    const ids = new Set<number>();
    if (!groundOnly)
      for (const tile of tiles) {
        const tileBounds: Bounds = {
          min: [Math.max(bounds.min[0], tile.x * span), Math.max(bounds.min[1], tile.z * span)],
          max: [
            Math.min(bounds.max[0], (tile.x + 1) * span),
            Math.min(bounds.max[1], (tile.z + 1) * span),
          ],
        };
        for (const cell of gridTiles(pad(tileBounds), collisionCellSpan, true))
          for (const id of manifest.cells[tileKey(cell)] ?? []) ids.add(id);
      }
    const collisionBlocks = [...ids]
      .sort((a, b) => a - b)
      .map((id) => manifest.collisionBlocks[id]);
    const groundBlocks = tiles.map((tile) => manifest.tiles[tileKey(tile)]);
    const groundBytes = groundBlocks.reduce((sum, block) => sum + block.length * 5, 0);
    const blocks: Request[] = [
      ...collisionBlocks.map((block) => ({
        kind: 'collision' as const,
        block,
        charge: block.length * 2,
      })),
      ...groundBlocks.map((block) => ({
        kind: 'ground' as const,
        block,
        charge: block.length * 5,
      })),
    ];
    const active = new Set(blocks.map(cacheKey));
    const temporary = blocks.reduce((sum, { charge }) => sum + charge, 0);
    const growth = blocks.reduce(
      (sum, request) => sum + (cache.has(cacheKey(request)) ? 0 : request.charge),
      0,
    );
    for (const [key, record] of cache) {
      if (retained + held + resident + temporary + growth <= budget) break;
      if (active.has(key)) continue;
      cache.delete(key);
      resident -= record.bytes;
    }
    const reserved = retained + held + resident + temporary + growth;
    if (reserved > budget)
      throw new Error(
        `Physical window exceeds memory budget: ${scene} ${JSON.stringify(bounds)} needs ${reserved} bytes, budget ${budget}`,
      );
    peak = Math.max(peak, reserved);

    await loadMissing(blocks, signal);
    const assemblyStarted = performance.now();
    const shapes: Shape[] = [];
    const groundTiles: GroundTile[] = [];
    for (const request of blocks) {
      const key = cacheKey(request);
      const entry = cache.get(key)!;
      cache.delete(key);
      cache.set(key, entry);
      if (request.kind === 'collision') {
        for (const shape of entry.value as Shape[])
          if (intersects(shape.record.bounds.min, shape.record.bounds.max, padded))
            shapes.push(shape);
      } else groundTiles.push(entry.value as GroundTile);
    }
    signal?.throwIfAborted();
    const positions = new Float64Array(shapes.reduce((n, shape) => n + shape.positions.length, 0));
    const indices = new Uint32Array(shapes.reduce((n, shape) => n + shape.indices.length, 0));
    let vp = 0,
      tp = 0;
    const records = shapes.map((shape) => {
      const record = { ...shape.record, first: tp / 3 };
      positions.set(shape.positions, vp);
      for (const index of shape.indices) indices[tp++] = index + vp / 3;
      vp += shape.positions.length;
      return record;
    });
    const walls = manifest.exclusions.filter((w) => intersects(w.min, w.max, padded));
    const staticSupports = [...new Set(shapes.flatMap(findFacilities))];
    const ground = assembleGroundTiles(groundTiles, { ...settings, bounds });
    assemblyMs += performance.now() - assemblyStarted;
    return {
      retainedBytes: temporary,
      groundBytes,
      revision,
      ground,
      collision: {
        positions,
        indices,
        records,
        walls,
        coverage: {
          complete: false,
          staticSupports,
        },
      },
    };
  }

  type Snapshot = Omit<Awaited<ReturnType<typeof prepare>>, 'groundBytes' | 'retainedBytes'> & {
    retain(scope?: 'ground'): () => void;
  };
  function withWindows<T>(
    windows: readonly Window[],
    signal: AbortSignal | undefined,
    use: (snapshots: readonly Snapshot[]) => T | Promise<T>,
    groundOnly = false,
  ) {
    if (closed) return Promise.reject(new Error('Physical scene loader is closed'));
    const result = tail.then(async () => {
      let held = 0;
      const snapshots: Snapshot[] = [];
      let releases: (() => void)[] | undefined = [];
      for (const window of windows) {
        signal?.throwIfAborted();
        const { groundBytes, retainedBytes, ...snapshot } = await prepare(
          describe(window),
          held,
          signal,
          groundOnly,
        );
        const collisionBytes = retainedBytes - groundBytes;
        let groundOwners = 0;
        let collisionOwners = 0;
        snapshots.push({
          ...snapshot,
          retain(scope) {
            if (groundOwners++ === 0) retained += groundBytes;
            if (!scope && collisionOwners++ === 0) retained += collisionBytes;
            let active = true;
            const release = () => {
              if (!active) return;
              active = false;
              if (--groundOwners === 0) retained -= groundBytes;
              if (!scope && --collisionOwners === 0) retained -= collisionBytes;
            };
            releases?.push(release);
            return release;
          },
        });
        held += retainedBytes;
      }
      try {
        return await use(snapshots);
      } catch (error) {
        for (const release of releases) release();
        throw error;
      } finally {
        releases = undefined;
      }
    });
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  return {
    manifest,
    digest,
    manifestBytes: bytes.length,
    describe,
    withWindows: <T>(
      windows: readonly Window[],
      signal: AbortSignal | undefined,
      use: (snapshots: readonly Snapshot[]) => T | Promise<T>,
    ) => withWindows(windows, signal, use),
    withGround<T>(
      window: Window,
      signal: AbortSignal | undefined,
      use: (
        snapshot: Pick<Snapshot, 'ground' | 'retain'> & { walls: Snapshot['collision']['walls'] },
      ) => T | Promise<T>,
    ) {
      return withWindows(
        [window],
        signal,
        ([snapshot]) =>
          use({
            ground: snapshot.ground,
            walls: snapshot.collision.walls,
            retain: snapshot.retain,
          }),
        true,
      );
    },
    withWindow<T>(
      window: Window,
      signal: AbortSignal | undefined,
      use: (snapshot: Snapshot) => T | Promise<T>,
    ) {
      return withWindows([window], signal, ([snapshot]) => use(snapshot));
    },
    stats: () => ({
      reads,
      collisionReads,
      readBytes,
      rangeReads,
      ioMs,
      decodeMs,
      assemblyMs,
      residentBytes: resident,
      retainedBytes: retained,
      peakReservedBytes: peak,
    }),
    async close() {
      closed = true;
      await tail;
      cache.clear();
      resident = 0;
      await Promise.all(Object.values(files).map((file) => file.close()));
    },
  };
}
