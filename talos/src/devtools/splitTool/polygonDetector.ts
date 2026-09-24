export type TileCoordinate = [number, number];

interface Edge {
    from: TileCoordinate;
    to: TileCoordinate;
    key: string;
}

const pointKey = ([x, y]: TileCoordinate): string => `${x},${y}`;
const samePoint = (a: TileCoordinate, b: TileCoordinate): boolean => a[0] === b[0] && a[1] === b[1];

const isCollinear = (a: TileCoordinate, b: TileCoordinate, c: TileCoordinate): boolean =>
    (a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1]);

const simplifyRing = (ring: TileCoordinate[]): TileCoordinate[] => {
    if (ring.length < 4) return ring;
    const closed = samePoint(ring[0], ring[ring.length - 1]);
    const points = closed ? ring.slice(0, -1) : [...ring];
    const result: TileCoordinate[] = [];
    points.forEach((point, index) => {
        const previous = points[(index - 1 + points.length) % points.length];
        const next = points[(index + 1) % points.length];
        if (!isCollinear(previous, point, next)) result.push(point);
    });
    if (result.length < 3) return ring;
    return [...result, [...result[0]]];
};

const polygonArea = (ring: TileCoordinate[]): number => {
    let area = 0;
    for (let i = 0; i < ring.length; i += 1) {
        const next = ring[(i + 1) % ring.length];
        area += ring[i][0] * next[1] - next[0] * ring[i][1];
    }
    return Math.abs(area) / 2;
};

const tracePolygons = (edges: Edge[]): TileCoordinate[][] => {
    const byStart = new Map<string, Edge[]>();
    edges.forEach((edge) => {
        const list = byStart.get(pointKey(edge.from)) ?? [];
        list.push(edge);
        byStart.set(pointKey(edge.from), list);
    });

    const used = new Set<string>();
    const polygons: TileCoordinate[][] = [];
    for (const start of edges) {
        if (used.has(start.key)) continue;
        used.add(start.key);
        const ring: TileCoordinate[] = [start.from, start.to];
        let current = start.to;
        for (let guard = 0; guard < edges.length * 2; guard += 1) {
            if (samePoint(current, ring[0])) break;
            const next = (byStart.get(pointKey(current)) ?? []).find((edge) => !used.has(edge.key));
            if (!next) break;
            used.add(next.key);
            ring.push(next.to);
            current = next.to;
        }
        if (ring.length >= 4 && samePoint(ring[0], ring[ring.length - 1])) {
            polygons.push(simplifyRing(ring));
        }
    }
    return polygons.sort((a, b) => polygonArea(b) - polygonArea(a));
};

export const detectPolygon = (tiles: Array<{ x: number; y: number }>, tileSize: number): number[][][] => {
    if (!tiles.length) return [];
    const occupied = new Set(tiles.map(({ x, y }) => `${x},${y}`));
    const edges: Edge[] = [];
    const add = (from: TileCoordinate, to: TileCoordinate, key: string) => edges.push({ from, to, key });

    tiles.forEach(({ x, y }) => {
        if (!occupied.has(`${x},${y - 1}`)) add([x * tileSize, y * tileSize], [(x + 1) * tileSize, y * tileSize], `${x},${y}:top`);
        if (!occupied.has(`${x + 1},${y}`)) add([(x + 1) * tileSize, y * tileSize], [(x + 1) * tileSize, (y + 1) * tileSize], `${x},${y}:right`);
        if (!occupied.has(`${x},${y + 1}`)) add([(x + 1) * tileSize, (y + 1) * tileSize], [x * tileSize, (y + 1) * tileSize], `${x},${y}:bottom`);
        if (!occupied.has(`${x - 1},${y}`)) add([x * tileSize, (y + 1) * tileSize], [x * tileSize, y * tileSize], `${x},${y}:left`);
    });
    return tracePolygons(edges);
};
