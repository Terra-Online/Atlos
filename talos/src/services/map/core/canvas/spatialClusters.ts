export interface ClusterPosition<T> { item: T; x: number; y: number }
export interface SpatialCluster<T> { members: T[]; x: number; y: number }

/** Deterministic nearest-centroid grouping; inspect nine cells instead of every existing group. */
export function clusterPositions<T>(points: Iterable<ClusterPosition<T>>, scale: number, radius: number): SpatialCluster<T>[] {
  interface Bucket extends SpatialCluster<T> { sumX: number; sumY: number; cell: string }
  const cells = new Map<string, Set<Bucket>>(), buckets: Bucket[] = [];
  const cellKey = (x: number, y: number) => `${Math.floor(x * scale / radius)}:${Math.floor(y * scale / radius)}`;
  const insert = (bucket: Bucket) => {
    let cell = cells.get(bucket.cell);
    if (!cell) cells.set(bucket.cell, cell = new Set());
    cell.add(bucket);
  };
  for (const point of points) {
    const cx = Math.floor(point.x * scale / radius), cy = Math.floor(point.y * scale / radius);
    let nearest: Bucket | undefined, distance = radius * radius;
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
      for (const bucket of cells.get(`${x}:${y}`) ?? []) {
        const squared = ((point.x - bucket.x) ** 2 + (point.y - bucket.y) ** 2) * scale * scale;
        if (squared < distance) { distance = squared; nearest = bucket; }
      }
    }
    if (!nearest) {
      const bucket: Bucket = { members: [point.item], x: point.x, y: point.y, sumX: point.x, sumY: point.y, cell: cellKey(point.x, point.y) };
      buckets.push(bucket); insert(bucket); continue;
    }
    nearest.members.push(point.item); nearest.sumX += point.x; nearest.sumY += point.y;
    nearest.x = nearest.sumX / nearest.members.length; nearest.y = nearest.sumY / nearest.members.length;
    const next = cellKey(nearest.x, nearest.y);
    if (next !== nearest.cell) { cells.get(nearest.cell)?.delete(nearest); nearest.cell = next; insert(nearest); }
  }
  return buckets;
}

interface LayoutSet {
  positions: Float64Array;
  layouts: Map<string, readonly SpatialCluster<number>[]>;
}
const MAX_SETS = 4;
const MAX_POINTS = 8192;
const MAX_LAYOUTS = 4;

/** Reuses ordered geometry across marker replacement without retaining its items. */
export class SpatialClusterCache {
  private sets: LayoutSet[] = [];
  private pointCount = 0;

  get(points: readonly { x: number; y: number }[], scale: number, radius: number): readonly SpatialCluster<number>[] {
    if (!points.length) return [];
    const key = `${scale}:${radius}`;
    const index = this.sets.findIndex(set => set.positions.length === points.length * 2
      && points.every((point, i) => set.positions[i * 2] === point.x && set.positions[i * 2 + 1] === point.y));
    let set = index < 0 ? undefined : this.sets.splice(index, 1)[0];
    const cached = set?.layouts.get(key);
    if (set && cached) {
      set.layouts.delete(key); set.layouts.set(key, cached); this.sets.push(set);
      return cached;
    }
    const result = clusterPositions(points.map((point, i) => ({ item: i, x: point.x, y: point.y })), scale, radius)
      .map(({ members, x, y }) => ({ members, x, y }));
    if (points.length > MAX_POINTS) return result;
    if (!set) {
      const positions = new Float64Array(points.length * 2);
      points.forEach((point, i) => { positions[i * 2] = point.x; positions[i * 2 + 1] = point.y; });
      set = { positions, layouts: new Map() };
      this.pointCount += points.length;
    }
    set.layouts.set(key, result);
    if (set.layouts.size > MAX_LAYOUTS) set.layouts.delete(set.layouts.keys().next().value!);
    this.sets.push(set);
    while (this.sets.length > MAX_SETS || this.pointCount > MAX_POINTS) {
      this.pointCount -= this.sets.shift()!.positions.length / 2;
    }
    return result;
  }
}
