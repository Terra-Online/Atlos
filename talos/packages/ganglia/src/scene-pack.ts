import { createHash } from 'node:crypto';
import { open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serialize } from 'node:v8';

import type { TileBuildOptions } from '#@/src/build.ts';
import type { CollisionGeometry, Surface, Vec3, Wall } from '#@/src/geometry.ts';

export const manifestName = 'physical.json';
export const collisionName = 'collision.bin';
export const groundName = 'ground.bin';
export const collisionCellSpan = 128;

export type Source = { buildGuid: string; contentHash: string };
export type Bounds = TileBuildOptions['bounds'];
export type Tile = { x: number; z: number };
export type Settings = Omit<TileBuildOptions, 'bounds' | 'tiles' | 'cache' | 'onTile'>;
export type Record = {
  id: number;
  first: number;
  count: number;
  bounds: { min: Vec3; max: Vec3 };
  walkable?: boolean;
};
export type StaticSupport = { id: string; model: string; pose: string };
export type StaticSupportMesh = StaticSupport & CollisionGeometry;
export type CollisionExport = CollisionGeometry & {
  records: Record[];
  coverage: { staticSupports?: StaticSupport[] };
  exclusions: Wall[];
};
export type GroundTile = Tile & { surfaces: Surface[] };
export type Block = { offset: number; length: number; sha256: string };
export type Shape = { positions: Float64Array; indices: Uint32Array; record: Record };
export interface Header {
  scene: string;
  source: Source;
  selection: unknown;
  settings: Settings;
}
export interface Manifest extends Header {
  collisionBlocks: Block[];
  cells: { [key: string]: number[] };
  tiles: { [key: string]: Block };
  exclusions: Wall[];
  staticSupports: StaticSupport[];
}

export const tileKey = ({ x, z }: Tile) => `${x},${z}`;
export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function collisionMesh(geometry: CollisionGeometry, first: number, count: number) {
  const indices = new Uint32Array(count * 3);
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < indices.length; i++) {
    const vertex = geometry.indices[first * 3 + i];
    low = Math.min(low, vertex);
    high = Math.max(high, vertex);
    indices[i] = vertex;
  }
  for (let i = 0; i < indices.length; i++) indices[i] -= low;
  const positions = new Float64Array((high - low + 1) * 3);
  for (let i = 0; i < positions.length; i++) positions[i] = geometry.positions[low * 3 + i];
  return { positions, indices };
}

export function collisionMeshDigest({ positions, indices }: Pick<Shape, 'positions' | 'indices'>) {
  return createHash('sha256')
    .update(`${positions.length}:${indices.length}:`)
    .update(new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength))
    .update(new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength))
    .digest('hex');
}

export function gridTiles(bounds: Bounds, span: number, inclusive = false): Tile[] {
  const result: Tile[] = [];
  const end = (edge: number) => (inclusive ? Math.floor(edge / span) + 1 : Math.ceil(edge / span));
  for (let z = Math.floor(bounds.min[1] / span); z < end(bounds.max[1]); z++)
    for (let x = Math.floor(bounds.min[0] / span); x < end(bounds.max[0]); x++)
      result.push({ x, z });
  return result;
}

/** Writes independently readable blocks. The caller owns publication of the output directory. */
export async function writeScenePack(
  root: string,
  header: Header,
  produce: (
    append: (collision: CollisionExport, tiles: GroundTile[]) => Promise<void>,
  ) => Promise<void>,
) {
  const manifest: Manifest = {
    ...header,
    collisionBlocks: [],
    cells: {},
    tiles: {},
    exclusions: [],
    staticSupports: [],
  };
  const shapes = new Set<string>();
  const exclusions = new Map<string, Wall>();
  const supports = new Map<string, StaticSupport>();
  const collision = await open(join(root, collisionName), 'wx');
  try {
    const ground = await open(join(root, groundName), 'wx');
    try {
      let collisionOffset = 0;
      let groundOffset = 0;
      const write = async (file: typeof ground, bytes: Buffer, offset: number): Promise<Block> => {
        const { bytesWritten } = await file.write(bytes, 0, bytes.length, offset);
        if (bytesWritten !== bytes.length) throw new Error('Incomplete physical pack write');
        return { offset, length: bytes.length, sha256: sha256(bytes) };
      };
      await produce(async (geometry, tiles) => {
        const buckets = new Map<string, Shape[]>();
        for (const record of geometry.records) {
          if (!record.count) continue;
          const { positions, indices } = collisionMesh(geometry, record.first, record.count);
          const shape = { positions, indices, record: { ...record, first: 0 } };
          const hash = createHash('sha256')
            .update(JSON.stringify(shape.record))
            .update(new Uint8Array(positions.buffer))
            .update(new Uint8Array(indices.buffer))
            .digest('hex');
          if (shapes.has(hash)) continue;
          shapes.add(hash);
          const { min } = record.bounds;
          const owner = tileKey({
            x: Math.floor(min[0] / collisionCellSpan),
            z: Math.floor(min[2] / collisionCellSpan),
          });
          const bucket = buckets.get(owner) ?? [];
          bucket.push(shape);
          buckets.set(owner, bucket);
        }
        for (const bucket of buckets.values()) {
          let group: Shape[] = [];
          let size = 0;
          const flush = async () => {
            if (!group.length) return;
            const block = await write(collision, serialize(group), collisionOffset);
            collisionOffset += block.length;
            const id = manifest.collisionBlocks.push(block) - 1;
            const keys = new Set<string>();
            for (const {
              record: {
                bounds: { min, max },
              },
            } of group)
              for (const tile of gridTiles(
                { min: [min[0], min[2]], max: [max[0], max[2]] },
                collisionCellSpan,
                true,
              ))
                keys.add(tileKey(tile));
            for (const key of keys) (manifest.cells[key] ??= []).push(id);
            group = [];
            size = 0;
          };
          for (const shape of bucket) {
            const bytes = shape.positions.byteLength + shape.indices.byteLength;
            if (size + bytes > 4 * 1024 ** 2) await flush();
            group.push(shape);
            size += bytes;
          }
          await flush();
        }
        for (const tile of tiles) {
          const key = tileKey(tile);
          if (Object.hasOwn(manifest.tiles, key)) throw new Error(`Duplicate ground tile ${key}`);
          const block = await write(ground, serialize(tile), groundOffset);
          groundOffset += block.length;
          manifest.tiles[key] = block;
        }
        for (const wall of geometry.exclusions) exclusions.set(JSON.stringify(wall), wall);
        for (const support of geometry.coverage.staticSupports ?? [])
          supports.set(support.id, support);
      });
      manifest.exclusions = [...exclusions.values()];
      manifest.staticSupports = [...supports.values()];
    } finally {
      await ground.close();
    }
  } finally {
    await collision.close();
  }
  await writeFile(join(root, manifestName), JSON.stringify(manifest), { flag: 'wx' });
}
