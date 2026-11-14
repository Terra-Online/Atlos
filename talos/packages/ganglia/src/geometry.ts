export type Vec3 = [number, number, number];

export interface Surface {
  id: string;
  vertices: Vec3[];
  portals?: number[];
}

export interface Portal {
  from: string;
  to: string;
  points: [Vec3, Vec3];
  /** Paired boundary intervals in matching XZ order. Omit both for a point transfer. */
  entry?: [Vec3, Vec3];
  exit?: [Vec3, Vec3];
}

export interface CollisionGeometry {
  /** World-space triangle positions, xyz packed; outward normals, metres. */
  positions: number[] | Float32Array | Float64Array;
  indices: number[] | Uint16Array | Uint32Array;
}

export interface Wall {
  min: Vec3;
  max: Vec3;
  state: 'active' | 'inactive' | 'unknown';
  padding?: number;
  /** Solid sphere, mutually exclusive with points and polygon. Bounds remain a
   * broad-phase enclosure. Padding expands the sphere uniformly. */
  sphere?: { center: Vec3; radius: number };
  /** Open, thin wall polyline. Mutually exclusive with polygon. */
  points?: [number, number][];
  /** Filled XZ ring extruded between min.y and max.y; closed implicitly. */
  polygon?: [number, number][];
}
