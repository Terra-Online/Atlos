type MapPoint = [number, number];

export type Wall = {
    id: string;
    subregion: string;
    tier: number;
    segment: [MapPoint, MapPoint];
};

type Module = { default: unknown };
const modules = import.meta.glob('./data/*.json') as Record<string, () => Promise<Module>>;
const loaded = new Map<string, Wall[]>();

export const loadMapSupplements = async (region: string): Promise<Wall[]> => {
    const cached = loaded.get(region);
    if (cached) return cached;
    const loader = modules[`./data/${region}.json`];
    if (!loader) return [];
    const { default: data } = await loader();
    if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
    const walls: Wall[] = [];
    for (const [subregion, rows] of Object.entries(data)) {
        if (!Array.isArray(rows)) continue;
        for (const row of rows as unknown[]) {
            if (!Array.isArray(row) || row.length !== 3) continue;
            const [id, tier, points] = row as unknown[];
            if (typeof id !== 'string' || typeof tier !== 'number' || !Number.isInteger(tier)) continue;
            if (!Array.isArray(points) || points.length !== 2) continue;
            const segment: MapPoint[] = [];
            for (const point of points as unknown[]) {
                if (!Array.isArray(point) || point.length !== 2 ||
                    typeof point[0] !== 'number' || !Number.isFinite(point[0]) ||
                    typeof point[1] !== 'number' || !Number.isFinite(point[1])) break;
                segment.push([point[0], point[1]]);
            }
            if (segment.length === 2) walls.push({ id, subregion, tier, segment: [segment[0], segment[1]] });
        }
    }
    loaded.set(region, walls);
    return walls;
};
