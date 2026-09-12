/** Game-space buckets. Exact strict bounds are retained after the coarse lookup. */
export class ProximityIndex<T> {
    private cells = new Map<string, { value: T; x: number; y: number; z: number }[]>();

    constructor(private radius = 20, private height = 6) {}

    add(value: T, position: { x: number; y: number; z: number }) {
        const { x, y, z } = position;
        if (![x, y, z].every(Number.isFinite)) return;
        const key = `${Math.floor(x / this.radius)},${Math.floor(z / this.radius)}`;
        const cell = this.cells.get(key) ?? [];
        if (!this.cells.has(key)) this.cells.set(key, cell);
        cell.push({ value, x, y, z });
    }

    query(position: { x: number; y: number; z: number }): T[] {
        const { x, y, z } = position;
        if (![x, y, z].every(Number.isFinite)) return [];
        const cx = Math.floor(x / this.radius), cz = Math.floor(z / this.radius);
        const result: T[] = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                for (const point of this.cells.get(`${cx + dx},${cz + dz}`) ?? []) {
                    if (Math.abs(point.x - x) < this.radius && Math.abs(point.z - z) < this.radius
                        && Math.abs(point.y - y) < this.height) result.push(point.value);
                }
            }
        }
        return result;
    }
}
