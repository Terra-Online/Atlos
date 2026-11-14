import type { Surface, Portal, CollisionGeometry } from '#@/src/geometry.ts';
export { buildGroundSurfaces, buildGroundTiles } from '#@/src/v1/geo/build.ts';
export { groundBuildIdentity } from '#@/src/v1/geo/build-identity.ts';
export type { CollisionGeometry } from '#@/src/geometry.ts';

export interface BuildOptions {
  profile: { radius: number; height: number };
  /** Degrees, greater than 0 and less than 90. */
  maxSlope: number;
  /** Metres. Ordinary bidirectional links use the smaller limit. */
  stepUp: number;
  stepDown: number;
  /** Horizontal and vertical voxel dimensions in metres. */
  cellSize: number;
  cellHeight: number;
  /** Optional XZ build rectangle in world metres. Full input height is retained.
   * Region edges are clearance-eroded; adjacent builds are not automatically stitched.
   * Supply complete intersecting collision geometry, including outside-origin actors.
   */
  bounds?: { min: [number, number]; max: [number, number] };
}

/** Importer-owned cache of padded native support meshes. Keys must bind exact
 * ordered geometry, body, voxel/step settings, source and generator identity.
 * Store the supplied mesh before core clipping; do not cache cross-tile portals.
 */
export interface TileCache {
  load(geometry: CollisionGeometry, options: BuildOptions): Promise<Surface[] | null>;
  save(geometry: CollisionGeometry, options: BuildOptions, surfaces: Surface[]): Promise<void>;
}

export type TileBuildOptions = BuildOptions & {
  bounds: { min: [number, number]; max: [number, number] };
  tileCells: number;
  /** Optional sparse selection on the same global grid. Unselected tiles remain
   * unmapped, never blocked or granted access. At most 512 unique tiles. */
  tiles?: { x: number; z: number }[];
  cache?: TileCache;
  onTile?: (progress: {
    x: number;
    z: number;
    completed: number;
    total: number;
    surfaces: number;
    cached: boolean;
    elapsedMs: number;
  }) => void;
};

export type TileBuildResult = {
  surfaces: Surface[];
  portals: Portal[];
  tiles: {
    x: number;
    z: number;
    bounds: { min: [number, number]; max: [number, number] };
    surfaces: number;
  }[];
};
