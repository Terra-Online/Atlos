import { routeFrom, type Surface, type Vec3 } from '@oem/ganglia';

type Data = {
    surfaces: Surface[];
    options: { profile: { height: number }; maxVertical: number };
};
type Region = {
    id: string;
    x: number;
    z: number;
    layer: number;
    min: number;
    max: number;
    position: Vec3;
};
type Edge = {
    from: string;
    to: string;
    cost: number;
    state: 'open';
    points: Vec3[];
};
type Prepared = { span: number; band: number; nodes: Region[]; edges: Edge[] };
export type Corridor = {
    kind: 'corridor-proposal';
    bounds: { min: [number, number]; max: [number, number] };
    tiles: { x: number; z: number }[];
    coarse: { regions: number; edges: number; path: Vec3[]; halo: number };
};
const cache = new WeakMap<Data, Prepared>();
const cell = (x: number, z: number) => `${x},${z}`;
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));

const prepare = (data: Data, span: number): Prepared => {
    const band = data.options.profile.height * 2;
    const previous = cache.get(data);
    if (previous?.span === span && previous.band === band) return previous;
    const regions = new Map<string, Region>();
    for (const surface of data.surfaces) {
        const min = [Infinity, Infinity, Infinity],
            max = [-Infinity, -Infinity, -Infinity];
        for (const point of surface.vertices)
            for (let axis = 0; axis < 3; axis++) {
                min[axis] = Math.min(min[axis], point[axis]);
                max[axis] = Math.max(max[axis], point[axis]);
            }
        for (
            let z = Math.floor(min[2] / span);
            z <= Math.floor(max[2] / span);
            z++
        ) {
            for (
                let x = Math.floor(min[0] / span);
                x <= Math.floor(max[0] / span);
                x++
            ) {
                for (
                    let layer = Math.floor(min[1] / band);
                    layer <= Math.floor(max[1] / band);
                    layer++
                ) {
                    const id = `${x},${z}/${layer}`,
                        low = Math.max(min[1], layer * band),
                        high = Math.min(max[1], (layer + 1) * band);
                    const region = regions.get(id);
                    if (region) {
                        region.min = Math.min(region.min, low);
                        region.max = Math.max(region.max, high);
                    } else
                        regions.set(id, {
                            id,
                            x,
                            z,
                            layer,
                            min: low,
                            max: high,
                            position: [0, 0, 0],
                        });
                }
            }
        }
    }
    const cells = new Map<string, Region[]>(),
        nodes = [...regions.values()],
        edges: Edge[] = [];
    for (const region of nodes) {
        region.position = [
            (region.x + 0.5) * span,
            (region.min + region.max) / 2,
            (region.z + 0.5) * span,
        ];
        const key = cell(region.x, region.z),
            entries = cells.get(key) ?? [];
        entries.push(region);
        cells.set(key, entries);
    }
    const connect = (a: Region, b: Region) => {
        // These are optimistic region relations, not executable walking edges.
        const cost = Math.max(band, distance(a.position, b.position));
        edges.push(
            {
                from: a.id,
                to: b.id,
                cost,
                state: 'open',
                points: [a.position, b.position],
            },
            {
                from: b.id,
                to: a.id,
                cost,
                state: 'open',
                points: [b.position, a.position],
            },
        );
    };
    for (const entries of cells.values()) {
        entries.sort((a, b) => a.layer - b.layer);
        for (let i = 1; i < entries.length; i++)
            connect(entries[i - 1], entries[i]);
        for (const a of entries)
            for (const [dx, dz] of [
                [1, 0],
                [0, 1],
                [1, 1],
                [-1, 1],
            ]) {
                for (const b of cells.get(cell(a.x + dx, a.z + dz)) ?? []) {
                    if (Math.max(a.min - b.max, b.min - a.max, 0) <= band)
                        connect(a, b);
                }
            }
    }
    const prepared = { span, band, nodes, edges };
    cache.set(data, prepared);
    return prepared;
};

const corridor = (
    points: Vec3[],
    prepared: Prepared,
    halo: number,
): Corridor | null => {
    const selected = new Map<string, { x: number; z: number }>();
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
            b = points[i];
        const count = Math.max(
            1,
            Math.ceil(
                (Math.max(Math.abs(b[0] - a[0]), Math.abs(b[2] - a[2])) /
                    prepared.span) *
                    2,
            ),
        );
        if (count > 1024) return null;
        for (let step = 0; step <= count; step++) {
            const x = Math.floor(
                (a[0] + ((b[0] - a[0]) * step) / count) / prepared.span,
            );
            const z = Math.floor(
                (a[2] + ((b[2] - a[2]) * step) / count) / prepared.span,
            );
            for (let dz = -halo; dz <= halo; dz++)
                for (let dx = -halo; dx <= halo; dx++) {
                    selected.set(cell(x + dx, z + dz), {
                        x: x + dx,
                        z: z + dz,
                    });
                }
        }
    }
    const tiles = [...selected.values()].sort((a, b) => a.z - b.z || a.x - b.x);
    if (!tiles.length || tiles.length > 512) return null;
    return {
        kind: 'corridor-proposal',
        tiles,
        bounds: {
            min: [
                Math.min(...tiles.map((t) => t.x)) * prepared.span,
                Math.min(...tiles.map((t) => t.z)) * prepared.span,
            ],
            max: [
                (Math.max(...tiles.map((t) => t.x)) + 1) * prepared.span,
                (Math.max(...tiles.map((t) => t.z)) + 1) * prepared.span,
            ],
        },
        coarse: {
            regions: prepared.nodes.length,
            edges: prepared.edges.length,
            path: points,
            halo,
        },
    };
};

/** Propose spatial corridors before allocating physical support graphs.
 * Occupancy and elevation bands intentionally overapproximate passages. Every
 * proposal remains unverified until its selected physical tiles and actions solve.
 * Geometry, rather than point identities, determines the alternatives.
 */
export const coarseCorridors = (
    data: Data,
    from: Vec3,
    to: Vec3,
    span = 38.4,
): Corridor[] => {
    const prepared = prepare(data, span),
        starts = nearest(from),
        goals = nearest(to);
    function nearest(point: Vec3) {
        const ranked = prepared.nodes
            .map((region) => ({
                region,
                gap: Math.hypot(
                    Math.max(
                        region.x * span - point[0],
                        point[0] - (region.x + 1) * span,
                        0,
                    ),
                    Math.max(region.min - point[1], point[1] - region.max, 0),
                    Math.max(
                        region.z * span - point[2],
                        point[2] - (region.z + 1) * span,
                        0,
                    ),
                ),
            }))
            .sort((a, b) => a.gap - b.gap);
        const gap = ranked[0]?.gap ?? Infinity;
        return ranked
            .filter((entry) => entry.gap <= gap + data.options.maxVertical)
            .slice(0, 4)
            .map((entry) => entry.region);
    }
    const nodes = [
        ...prepared.nodes,
        { id: '@start', position: from },
        { id: '@goal', position: to },
    ];
    const connectors: Edge[] = [
        ...starts.map((region) => ({
            from: '@start',
            to: region.id,
            cost: distance(from, region.position),
            state: 'open' as const,
            points: [from, region.position],
        })),
        ...goals.map((region) => ({
            from: region.id,
            to: '@goal',
            cost: distance(region.position, to),
            state: 'open' as const,
            points: [region.position, to],
        })),
    ];
    const penalties = new Map<string, number>(),
        paths: Vec3[][] = [],
        signatures = new Set<string>();
    const positionCell = (p: Vec3) =>
        cell(Math.floor(p[0] / span), Math.floor(p[2] / span));
    for (let attempt = 0; attempt < 3; attempt++) {
        const graph = {
            nodes,
            edges: [
                ...prepared.edges.map((edge) => ({
                    ...edge,
                    cost:
                        edge.cost *
                        (1 +
                            3 *
                                Math.max(
                                    penalties.get(
                                        positionCell(edge.points[0]),
                                    ) ?? 0,
                                    penalties.get(
                                        positionCell(edge.points[1]),
                                    ) ?? 0,
                                )),
                })),
                ...connectors,
            ],
        };
        const route = routeFrom(
            graph,
            [{ id: 'proposal', node: '@start', cost: 0, state: 'available' }],
            '@goal',
        );
        if (route.status !== 'complete') break;
        const signature = route.points.map(positionCell).join('/');
        if (!signatures.has(signature)) {
            paths.push(route.points);
            signatures.add(signature);
        }
        for (const key of new Set(route.points.map(positionCell)))
            penalties.set(key, (penalties.get(key) ?? 0) + 1);
    }
    if (!paths.length) paths.push([from, to]);
    const proposals = paths
        .map((points) => corridor(points, prepared, 1))
        .filter((value): value is Corridor => value !== null);
    for (let halo = 2; proposals.length < 4 && halo <= 4; halo++) {
        const wider = corridor(paths[0], prepared, halo);
        if (wider) proposals.push(wider);
    }
    return proposals;
};
