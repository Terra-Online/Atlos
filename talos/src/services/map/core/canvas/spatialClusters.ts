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
