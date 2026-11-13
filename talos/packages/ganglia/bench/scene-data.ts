import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { deserialize } from 'node:v8';

import type { GroundOptions, Surface } from '@opendfieldmap/ganglia';
import type { Corridor, SceneNavigation } from '@opendfieldmap/ganglia/solver';
import { physicalCoverage, physicalTileSpan } from '@opendfieldmap/ganglia/solver/host';

export type Source = { buildGuid: string; contentHash: string };
type Bounds = { min: [number, number]; max: [number, number] };
type Tile = { x: number; z: number };
type Navigation = SceneNavigation & { scene: string; source: Source };
export type Ground = {
  scene: string;
  source: Source;
  selection?: unknown;
  surfaces: Surface[];
  options: GroundOptions;
  build: { bounds: Bounds; cellSize: number; tileCells: number };
  tiles: Tile[];
};
type Collision = {
  scene: string;
  source: Source;
  selection?: unknown;
  options: { profile: GroundOptions['profile']; bounds: Bounds; tiles?: Tile[] };
};
export type PhysicalFiles = {
  ground: string;
  collision: string;
  movement: string;
  devices?: string;
};
export type PhysicalRegion = {
  files: PhysicalFiles;
  ground: Ground;
  tiles: Set<string>;
  binding: string;
};
export interface RegionBuildRequest {
  scene: string;
  source: Source;
  bounds: number[];
  tiles: Tile[];
}
export type RegionBuild = (
  request: RegionBuildRequest,
) => Promise<{ ground: string; collision: string }>;
const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';
const tileKey = (tile: Tile) => `${tile.x},${tile.z}`;

export async function loadSceneData(dataRoot: string, scene: string, build?: RegionBuild) {
  const hashes: Record<string, string> = {};
  const inputs = new Map<string, unknown>();
  let inputBytes = 0;
  let inputLoadMs = 0;
  const read = async <T>(name: string): Promise<T> => {
    if (inputs.has(name)) return inputs.get(name) as T;
    const started = performance.now();
    try {
      const bytes = await readFile(name);
      // Large collision snapshots exceed V8's single-string limit. Binary inputs
      // keep exact numeric buffers outside the JS heap; decoding remains setup work.
      const value: unknown = name.endsWith('.bin')
        ? deserialize(bytes)
        : JSON.parse(bytes.toString());
      inputBytes += bytes.byteLength;
      hashes[name] = createHash('sha256').update(bytes).digest('hex');
      inputs.set(name, value);
      return value as T;
    } finally {
      inputLoadMs += performance.now() - started;
    }
  };
  const navigation = await read<Navigation>(resolve(dataRoot, `routing/${scene}-ground-all.json`));
  const movementFile = resolve(dataRoot, 'routing/movement-settings-current.json');
  const movement = await read<{
    source: Source;
    defaultProfile: GroundOptions['profile'];
    sustainedSprint: GroundOptions['locomotion'];
  }>(movementFile);
  if (
    navigation.scene !== scene ||
    !isDeepStrictEqual(navigation.source, movement.source) ||
    !isDeepStrictEqual(navigation.options.profile, movement.defaultProfile)
  )
    throw new Error('Navigation and movement snapshot mismatch');
  if (!movement.sustainedSprint) throw new Error('Missing locomotion settings');
  let devicesFile: string | undefined = resolve(
    dataRoot,
    `routing/${scene}-traversal-devices.json`,
  );
  try {
    await read(devicesFile);
  } catch (error) {
    if (!missing(error)) throw error;
    devicesFile = undefined;
  }
  const regions: PhysicalRegion[] = [];
  const collisionFile = async (prefix: string) => {
    const binary = `${prefix}.bin`;
    try {
      await read<Collision>(binary);
      return binary;
    } catch (error) {
      if (!missing(error)) throw error;
      return `${prefix}.json`;
    }
  };
  const loadRegion = async (groundFile: string, collisionFile: string) => {
    const ground = await read<Ground>(groundFile);
    const collision = await read<Collision>(collisionFile);
    if (
      ground.scene !== scene ||
      collision.scene !== scene ||
      !isDeepStrictEqual(ground.source, navigation.source) ||
      !isDeepStrictEqual(collision.source, navigation.source) ||
      !isDeepStrictEqual(ground.options.profile, movement.defaultProfile) ||
      !isDeepStrictEqual(collision.options.profile, movement.defaultProfile) ||
      !isDeepStrictEqual(ground.selection, collision.selection)
    )
      throw new Error(`Navigation and physics snapshot mismatch: ${groundFile}`);
    if (
      !ground.build?.bounds ||
      !isDeepStrictEqual(ground.build.bounds, collision.options.bounds) ||
      ground.build.cellSize * ground.build.tileCells !== physicalTileSpan ||
      !Array.isArray(ground.tiles) ||
      ground.tiles.some((tile) => !Number.isSafeInteger(tile.x) || !Number.isSafeInteger(tile.z))
    )
      throw new Error(`Invalid physical coverage: ${groundFile}`);
    const files = {
      ground: groundFile,
      collision: collisionFile,
      movement: movementFile,
      devices: devicesFile,
    };
    const region = {
      files,
      ground,
      tiles: new Set(ground.tiles.map(tileKey)),
      binding: JSON.stringify(
        [groundFile, collisionFile, movementFile, devicesFile].map((file) => file && hashes[file]),
      ),
    };
    regions.push(region);
    // Preparation appends regions, while a later process loads filenames in
    // order. Both must select the same physical snapshot for overlapping input.
    const area = (region: PhysicalRegion) => {
      const { min, max } = region.ground.build.bounds;
      return (max[0] - min[0]) * (max[1] - min[1]);
    };
    regions.sort((a, b) => {
      return (
        area(a) - area(b) ||
        a.tiles.size - b.tiles.size ||
        (a.files.ground < b.files.ground ? -1 : a.files.ground > b.files.ground ? 1 : 0)
      );
    });
    return region;
  };
  const directory = resolve(dataRoot, `scene-${scene}`);
  // Only absence of the legacy ground file is optional. A half-written pair is
  // rejected instead of silently falling through to another physical snapshot.
  const legacyGround = resolve(directory, 'ground.json');
  try {
    await read<Ground>(legacyGround);
  } catch (error) {
    if (!missing(error)) throw error;
  }
  if (inputs.has(legacyGround))
    await loadRegion(legacyGround, await collisionFile(resolve(directory, 'collision')));
  let names: string[];
  try {
    names = await readdir(resolve(directory, 'regions'));
  } catch (error) {
    if (!missing(error)) throw error;
    names = [];
  }
  for (const name of names.sort())
    if (name.endsWith('.ground.json'))
      await loadRegion(
        resolve(directory, 'regions', name),
        await collisionFile(
          resolve(directory, 'regions', name.replace(/\.ground\.json$/, '.collision')),
        ),
      );

  const select = (
    start: number[],
    target: number[],
    options: { margin: number; corridor: Corridor },
  ) => {
    const { bounds } = physicalCoverage(start, target, options);
    return regions.find((region) => {
      const available = region.ground.build.bounds;
      if (
        bounds[0] < available.min[0] ||
        bounds[1] < available.min[1] ||
        bounds[2] > available.max[0] ||
        bounds[3] > available.max[1]
      )
        return false;
      // A sparse exporter selection can have holes inside its enclosing bounds.
      // Empty built tiles count as coverage; absent tiles never do.
      return options.corridor.tiles.every((tile) => region.tiles.has(tileKey(tile)));
    });
  };
  const query = async (
    start: number[],
    target: number[],
    options: { startBuild: boolean; margin: number; corridor: Corridor },
  ) => {
    const existing = select(start, target, options);
    if (existing) return existing;
    if (build) {
      if (!options.startBuild) return undefined;
      const { bounds } = physicalCoverage(start, target, options);
      const files = await build({
        scene,
        source: navigation.source,
        bounds,
        tiles: options.corridor.tiles,
      });
      await loadRegion(resolve(files.ground), resolve(files.collision));
      const region = select(start, target, options);
      if (region) return region;
    }
    throw new Error(`Missing physical coverage ${JSON.stringify(options.corridor)}`);
  };
  return {
    navigation,
    locomotion: movement.sustainedSprint,
    hashes,
    inputs,
    regions,
    select,
    query,
    loadRegion,
    get inputLoadMs() {
      return inputLoadMs;
    },
    get inputBytes() {
      return inputBytes;
    },
  };
}

export type SceneData = Awaited<ReturnType<typeof loadSceneData>>;
