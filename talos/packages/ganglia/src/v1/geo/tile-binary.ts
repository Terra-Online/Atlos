import type { Surface, Vec3 } from '#@/src/geometry.ts';

// Compact binary wire format for per-tile walkable Surface[] snapshots ("GTS1"):
//   Header (24 bytes, 6 x uint32 LE):
//     [0] magic        = 0x31535447 ('G','T','S','1')
//     [1] flags        = bit 0: 1 = Float64 vertices, 0 = Float32 vertices
//                        bit 1: 1 = explicit per-surface portal arrays present
//     [2] vertexCount  = unique deduplicated 3D vertices
//     [3] surfaceCount = number of convex surface polygons
//     [4] totalVertRefs = sum of surface.vertices.length
//     [5] totalPortals = sum of explicit surface.portals.length
//   Body (4-byte aligned sections, vertex pool 8-byte aligned at byte offset 24):
//     1. Vertex pool: Float64Array(vertexCount * 3) or Float32Array(vertexCount * 3)
//     2. Vertex counts per surface: Uint32Array(surfaceCount)
//     3. Vertex indices: Uint32Array(totalVertRefs)
//     4. Optional portal section (iff flags & 2):
//          - Uint32Array(surfaceCount): 0xffffffff means portals === undefined,
//            else count of portal edge indices
//          - Uint32Array(totalPortals): concatenated portal edge indices
//     5. Surface IDs:
//          - Uint32Array(surfaceCount): UTF-8 byte lengths
//          - Uint8Array: concatenated UTF-8 surface IDs

const MAGIC = 0x31535447; // 'GTS1' little-endian
const FLAG_FLOAT64 = 1;
const FLAG_HAS_PORTALS = 2;
const FLAG_U16_INDICES = 4;
const PORTALS_UNDEFINED = 0xffffffff;
const HEADER_BYTES = 24;
const align4 = (n: number) => (n + 3) & ~3;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface EncodeTileSurfacesOptions {
  /** Vertex coordinate precision. Defaults to 'float32' (matching Recast's
   * native voxel output for ~8x-10x smaller tiles); pass 'float64' when exact
   * double-precision coordinates must roundtrip bit-for-bit.
   */
  precision?: 'float32' | 'float64';
}

/** Encode a tile's Surface[] into a compact deduplicated binary buffer. */
export function encodeTileSurfaces(
  surfaces: readonly Surface[],
  options?: EncodeTileSurfacesOptions,
): Uint8Array {
  const float64 = options?.precision === 'float64';
  const surfaceCount = surfaces.length;

  // Deduplicate 3D vertices into a contiguous pool.
  const vertexMap = new Map<string, number>();
  const uniqueCoords: number[] = [];
  const vertCounts = new Uint32Array(surfaceCount);
  let totalVertRefs = 0;
  let hasPortals = false;
  let totalPortals = 0;

  for (let i = 0; i < surfaceCount; i++) {
    const surface = surfaces[i];
    const verts = surface.vertices;
    vertCounts[i] = verts.length;
    totalVertRefs += verts.length;
    if (surface.portals !== undefined) {
      hasPortals = true;
      totalPortals += surface.portals.length;
    }
  }

  const vertIndices = new Uint32Array(totalVertRefs);
  const portalCounts = hasPortals ? new Uint32Array(surfaceCount) : null;
  const portalIndices = hasPortals ? new Uint32Array(totalPortals) : null;
  const idBytesList: Uint8Array[] = new Array(surfaceCount);
  const idLengths = new Uint32Array(surfaceCount);
  let totalIdBytes = 0;

  let vWrite = 0;
  let pWrite = 0;
  for (let i = 0; i < surfaceCount; i++) {
    const surface = surfaces[i];
    const encodedId = textEncoder.encode(surface.id);
    idBytesList[i] = encodedId;
    idLengths[i] = encodedId.byteLength;
    totalIdBytes += encodedId.byteLength;

    const verts = surface.vertices;
    for (let j = 0; j < verts.length; j++) {
      const p = verts[j];
      const x = float64 ? p[0] : Math.fround(p[0]);
      const y = float64 ? p[1] : Math.fround(p[1]);
      const z = float64 ? p[2] : Math.fround(p[2]);
      const key = `${x},${y},${z}`;
      let idx = vertexMap.get(key);
      if (idx === undefined) {
        idx = uniqueCoords.length / 3;
        vertexMap.set(key, idx);
        uniqueCoords.push(x, y, z);
      }
      vertIndices[vWrite++] = idx;
    }

    if (hasPortals) {
      if (surface.portals === undefined) {
        portalCounts![i] = PORTALS_UNDEFINED;
      } else {
        portalCounts![i] = surface.portals.length;
        for (let j = 0; j < surface.portals.length; j++) {
          portalIndices![pWrite++] = surface.portals[j];
        }
      }
    }
  }

  const vertexCount = uniqueCoords.length / 3;
  const useU16 = vertexCount <= 0xffff;
  const coordBytes = vertexCount * 3 * (float64 ? 8 : 4);
  const vertIndexBytes = align4(totalVertRefs * (useU16 ? 2 : 4));
  const portalSectionBytes = hasPortals ? surfaceCount * 4 + totalPortals * 4 : 0;
  const totalBytes =
    HEADER_BYTES +
    coordBytes +
    surfaceCount * 4 +
    vertIndexBytes +
    portalSectionBytes +
    surfaceCount * 4 +
    totalIdBytes;

  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const flags =
    (float64 ? FLAG_FLOAT64 : 0) |
    (hasPortals ? FLAG_HAS_PORTALS : 0) |
    (useU16 ? FLAG_U16_INDICES : 0);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, flags, true);
  view.setUint32(8, vertexCount, true);
  view.setUint32(12, surfaceCount, true);
  view.setUint32(16, totalVertRefs, true);
  view.setUint32(20, totalPortals, true);

  let offset = HEADER_BYTES;
  if (float64) {
    new Float64Array(buffer, offset, vertexCount * 3).set(uniqueCoords);
  } else {
    new Float32Array(buffer, offset, vertexCount * 3).set(uniqueCoords);
  }
  offset += coordBytes;

  new Uint32Array(buffer, offset, surfaceCount).set(vertCounts);
  offset += surfaceCount * 4;

  if (useU16) {
    const outIdx = new Uint16Array(buffer, offset, totalVertRefs);
    for (let i = 0; i < totalVertRefs; i++) outIdx[i] = vertIndices[i];
  } else {
    new Uint32Array(buffer, offset, totalVertRefs).set(vertIndices);
  }
  offset += vertIndexBytes;

  if (hasPortals) {
    new Uint32Array(buffer, offset, surfaceCount).set(portalCounts!);
    offset += surfaceCount * 4;
    new Uint32Array(buffer, offset, totalPortals).set(portalIndices!);
    offset += totalPortals * 4;
  }

  new Uint32Array(buffer, offset, surfaceCount).set(idLengths);
  offset += surfaceCount * 4;

  for (let i = 0; i < surfaceCount; i++) {
    bytes.set(idBytesList[i], offset);
    offset += idBytesList[i].byteLength;
  }

  return bytes;
}

/** Decode a GTS1 binary tile surface buffer directly via TypedArray views.
 * Optional `idPrefix` prepends a tile prefix (e.g. "3,-2/") to each surface ID.
 */
export function decodeTileSurfaces(data: Uint8Array, idPrefix = ''): Surface[] {
  if (data.byteLength < HEADER_BYTES) {
    throw new Error('Invalid GTS1 tile surface buffer: truncated header');
  }
  // Ensure 8-byte alignment for direct Float64Array/Uint32Array views.
  const aligned =
    data.byteOffset % 8 === 0
      ? data
      : (() => {
          const copy = new Uint8Array(data.byteLength);
          copy.set(data);
          return copy;
        })();

  const view = new DataView(aligned.buffer, aligned.byteOffset, aligned.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) {
    throw new Error(`Invalid GTS1 tile surface magic: 0x${magic.toString(16)}`);
  }
  const flags = view.getUint32(4, true);
  const float64 = (flags & FLAG_FLOAT64) !== 0;
  const hasPortals = (flags & FLAG_HAS_PORTALS) !== 0;
  const useU16 = (flags & FLAG_U16_INDICES) !== 0;
  const vertexCount = view.getUint32(8, true);
  const surfaceCount = view.getUint32(12, true);
  const totalVertRefs = view.getUint32(16, true);
  const totalPortals = view.getUint32(20, true);

  const coordBytes = vertexCount * 3 * (float64 ? 8 : 4);
  const vertIndexBytes = align4(totalVertRefs * (useU16 ? 2 : 4));
  const portalSectionBytes = hasPortals ? surfaceCount * 4 + totalPortals * 4 : 0;
  const minBytes =
    HEADER_BYTES +
    coordBytes +
    surfaceCount * 4 +
    vertIndexBytes +
    portalSectionBytes +
    surfaceCount * 4;
  if (aligned.byteLength < minBytes) {
    throw new Error('Invalid GTS1 tile surface buffer: truncated body');
  }

  let offset = aligned.byteOffset + HEADER_BYTES;
  const coords = float64
    ? new Float64Array(aligned.buffer, offset, vertexCount * 3)
    : new Float32Array(aligned.buffer, offset, vertexCount * 3);
  offset += coordBytes;

  const vertCounts = new Uint32Array(aligned.buffer, offset, surfaceCount);
  offset += surfaceCount * 4;

  const vertIndices = useU16
    ? new Uint16Array(aligned.buffer, offset, totalVertRefs)
    : new Uint32Array(aligned.buffer, offset, totalVertRefs);
  offset += vertIndexBytes;

  let portalCounts: Uint32Array | null = null;
  let portalIndices: Uint32Array | null = null;
  if (hasPortals) {
    portalCounts = new Uint32Array(aligned.buffer, offset, surfaceCount);
    offset += surfaceCount * 4;
    portalIndices = new Uint32Array(aligned.buffer, offset, totalPortals);
    offset += totalPortals * 4;
  }

  const idLengths = new Uint32Array(aligned.buffer, offset, surfaceCount);
  offset += surfaceCount * 4;

  // Materialize pooled Vec3 tuples once per unique vertex.
  const pool: Vec3[] = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const cOff = i * 3;
    pool[i] = [coords[cOff], coords[cOff + 1], coords[cOff + 2]];
  }

  const surfaces: Surface[] = new Array(surfaceCount);
  let vRead = 0;
  let pRead = 0;
  let idOffset = offset - aligned.byteOffset;
  for (let i = 0; i < surfaceCount; i++) {
    const idLen = idLengths[i];
    if (idOffset + idLen > aligned.byteLength) {
      throw new Error('Invalid GTS1 tile surface buffer: truncated surface ID');
    }
    const rawId = textDecoder.decode(aligned.subarray(idOffset, idOffset + idLen));
    idOffset += idLen;
    const id = idPrefix ? `${idPrefix}${rawId}` : rawId;

    const vc = vertCounts[i];
    if (vRead + vc > totalVertRefs) {
      throw new Error('Invalid GTS1 tile surface buffer: vertex count overflow');
    }
    const vertices: Vec3[] = new Array(vc);
    for (let j = 0; j < vc; j++) {
      const vi = vertIndices[vRead++];
      if (vi >= vertexCount) {
        throw new Error('Invalid GTS1 tile surface buffer: vertex index out of range');
      }
      const p = pool[vi];
      vertices[j] = [p[0], p[1], p[2]];
    }

    if (hasPortals) {
      const pc = portalCounts![i];
      if (pc !== PORTALS_UNDEFINED) {
        if (pRead + pc > totalPortals) {
          throw new Error('Invalid GTS1 tile surface buffer: portal count overflow');
        }
        const portals = new Array<number>(pc);
        for (let j = 0; j < pc; j++) portals[j] = portalIndices![pRead++];
        surfaces[i] = { id, vertices, portals };
        continue;
      }
    }
    surfaces[i] = { id, vertices };
  }

  return surfaces;
}

/** Estimate resident heap footprint of decoded per-tile surfaces for LRU budgeting. */
export const estimateTileSurfaceBytes = (surfaces: readonly Surface[]): number => {
  let vertices = 0;
  for (let i = 0; i < surfaces.length; i++) vertices += surfaces[i].vertices.length;
  return Math.max(512, surfaces.length * 160 + vertices * 64);
};

/** Byte-bounded in-memory LRU cache for per-tile decoded surfaces.
 * Avoids repeated disk reads and decodes across overlapping, expanded, or
 * bisected route windows.
 */
export function createTileSurfaceCache(options?: { maxBytes?: number }) {
  const maxBytes = options?.maxBytes ?? 256 * 1024 * 1024;
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error('Invalid tile surface cache byte budget');
  }
  const entries = new Map<string, { surfaces: Surface[]; bytes: number }>();
  let totalBytes = 0;
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  const evict = () => {
    while (totalBytes > maxBytes && entries.size > 1) {
      const oldestKey = entries.keys().next().value!;
      const oldest = entries.get(oldestKey)!;
      entries.delete(oldestKey);
      totalBytes -= oldest.bytes;
      evictions++;
    }
  };

  return {
    get(key: string): Surface[] | undefined {
      const entry = entries.get(key);
      if (!entry) {
        misses++;
        return undefined;
      }
      hits++;
      entries.delete(key);
      entries.set(key, entry);
      return entry.surfaces;
    },
    set(key: string, surfaces: Surface[]) {
      const prev = entries.get(key);
      if (prev) {
        totalBytes -= prev.bytes;
        entries.delete(key);
      }
      const bytes = estimateTileSurfaceBytes(surfaces);
      entries.set(key, { surfaces, bytes });
      totalBytes += bytes;
      evict();
    },
    clear() {
      entries.clear();
      totalBytes = 0;
    },
    stats() {
      return {
        entries: entries.size,
        bytes: totalBytes,
        maxBytes,
        hits,
        misses,
        evictions,
      };
    },
  };
}
