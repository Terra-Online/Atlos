import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import {
    createGroundPlanner,
    projectGoal,
    projectPoint,
    type GroundArrival,
    type GroundOptions,
    type InteractionGoal,
    type Route,
    type Surface,
    type Vec3,
} from '@oem/ganglia';
import {
    physicalMargins,
    physicalTileSpan,
    physicalRouteBuilder,
} from './physical-route-builder.ts';

import {
    coarseCorridors,
    coarseWaypoints,
    type Corridor,
} from './coarse-route.ts';

import {
    travelArrivals,
    type TravelPoint,
    type TravelArrival,
} from './travel-arrivals.ts';

type Source = { buildGuid: string; contentHash: string };
type Bounds = { min: [number, number]; max: [number, number] };
type Data = {
    scene: string;
    level?: string;
    progression?: 'completed' | 'fully-enabled';
    source: Source;
    bounds?: Bounds;
    surfaces: Surface[];
    options: GroundOptions & {
        portals?: { from: string; to: string; points: [Vec3, Vec3] }[];
    };
    arrivals: GroundArrival[];
    coverage?: unknown;
    selection?: unknown;
};
type IndexedData = { data: Data; bounds: Float64Array };

type InteractionPoint = {
    id: string;
    level: string;
    position: Vec3;
    template: string;
    templatePath: string | null;
    navigationGoal: { position: Vec3; interaction: InteractionGoal } | null;
    effective: { unresolved: string[] };
    navigationUnresolved?: string[];
};
type InteractionCatalog = {
    scene: string;
    source: Source;
    points: Map<string, InteractionPoint>;
};
type Answer = { value: unknown; status: number };
type Result = {
    scene: string;
    source: Source;
    status: string;
    route?: Route;
    diagnostics?: unknown;
};
type Candidate = {
    log?: string;
    status: 'candidate';
    route: Extract<Route, { status: 'complete' }>;
    optimizing?: boolean;
    optimizationMessage?: string;
    diagnostics?: {
        anchorCandidates?: number;
        attempts?: unknown[];
        traversal?: unknown;
    };
};
type Query = {
    pending: Promise<Answer>;
    done: boolean;
    progress?: boolean;
    marginIndex: number;
    anchorIndex: number;
    log?: string;
    corridors?: Corridor[];
    candidate?: Candidate;
};

const finiteVector = (value: unknown): value is Vec3 =>
    Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const sameSource = (a: Source, b: Source) =>
    a.buildGuid === b.buildGuid && a.contentHash === b.contentHash;
const intersects = (a: Bounds, b: Bounds) =>
    a.min[0] <= b.max[0] &&
    a.max[0] >= b.min[0] &&
    a.min[1] <= b.max[1] &&
    a.max[1] >= b.min[1];
const contains = (bounds: Bounds, point: Vec3) =>
    point[0] >= bounds.min[0] &&
    point[0] <= bounds.max[0] &&
    point[2] >= bounds.min[1] &&
    point[2] <= bounds.max[1];

const indexData = (data: Data): IndexedData => {
    if (
        !data.source ||
        !Array.isArray(data.surfaces) ||
        !Array.isArray(data.arrivals) ||
        !data.options ||
        !Array.isArray(data.options.walls)
    )
        throw new Error('Invalid local routing data');
    const bounds = new Float64Array(data.surfaces.length * 4);
    data.surfaces.forEach((surface, i) => {
        if (
            !Array.isArray(surface.vertices) ||
            surface.vertices.length < 3 ||
            !surface.vertices.every(finiteVector)
        )
            throw new Error('Invalid local ground surface');
        bounds[i * 4] = Math.min(...surface.vertices.map((p) => p[0]));
        bounds[i * 4 + 1] = Math.min(...surface.vertices.map((p) => p[2]));
        bounds[i * 4 + 2] = Math.max(...surface.vertices.map((p) => p[0]));
        bounds[i * 4 + 3] = Math.max(...surface.vertices.map((p) => p[2]));
    });
    return { data, bounds };
};

const normalizeData = (value: object, base: Data): IndexedData => {
    const result = value as Data & { build?: { bounds?: Bounds } };
    const bounds = result.build?.bounds;
    if (
        result.scene !== base.scene ||
        !result.source ||
        !sameSource(result.source, base.source) ||
        !bounds ||
        !Array.isArray(bounds.min) ||
        !Array.isArray(bounds.max) ||
        bounds.min.length !== 2 ||
        bounds.max.length !== 2 ||
        ![...bounds.min, ...bounds.max].every(Number.isFinite) ||
        bounds.min.some((value, axis) => value >= bounds.max[axis]) ||
        !result.options ||
        !Array.isArray(result.options.walls)
    )
        throw new Error('Invalid completed physical ground build');
    return indexData({
        ...result,
        bounds,
        arrivals: base.arrivals,
        options: {
            ...result.options,
            walls: [...base.options.walls, ...result.options.walls],
        },
    });
};

type Projection = {
    mapped: boolean;
    heightOffset: number | null;
    position: Vec3 | null;
    nearestBelowOffset: number | null;
};
const projection = (
    surfaces: Surface[],
    point: Vec3,
    maxVertical: number,
    direction: 'nearest' | 'near-or-below',
): Projection => {
    const strict = projectPoint(surfaces, point, { maxVertical });
    let nearestBelow: Vec3 | null = null;
    for (const surface of surfaces) {
        const support = projectPoint([surface], point, { maxVertical: 4 });
        if (
            support &&
            support.position[1] <= point[1] + 1e-6 &&
            (!nearestBelow || support.position[1] > nearestBelow[1])
        )
            nearestBelow = support.position;
    }
    const position =
        strict?.position ??
        (direction === 'near-or-below' ? nearestBelow : null);
    return {
        mapped: position !== null,
        heightOffset: position ? point[1] - position[1] : null,
        position,
        nearestBelowOffset: nearestBelow ? point[1] - nearestBelow[1] : null,
    };
};

const send = (response: ServerResponse, value: unknown, status = 200) => {
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end(JSON.stringify(value));
};

/** Local candidate inspection. Cached source arrays are never mutated by a query. */
export function routeServer(
    directory: string | undefined,
    build: {
        extractor?: string;
        config?: string;
        node?: string;
        solver?: string;
    } = {},
): Plugin {
    const cache = new Map<string, Promise<IndexedData>>();
    const builder = physicalRouteBuilder({ ...build, directory });
    let builtCache = new WeakMap<object, IndexedData>();
    let travel: Promise<{ source: Source; points: TravelPoint[] }> | undefined;
    let physical: Promise<IndexedData | null> | undefined;
    const interactionCache = new Map<
        string,
        Promise<InteractionCatalog | null>
    >();
    const queries = new Map<string, Query>();
    let removeCloseListener = () => {};
    const close = async () => {
        const drained = builder.close();
        cache.clear();
        interactionCache.clear();
        queries.clear();
        builtCache = new WeakMap();
        travel = undefined;
        physical = undefined;
        removeCloseListener();
        await drained;
    };
    const read = async (name: string) =>
        JSON.parse(await readFile(resolve(directory!, name), 'utf8'));
    const sceneData = (scene: string) => {
        let pending = cache.get(scene);
        if (!pending) {
            pending = read(`${scene}-ground-all.json`)
                .then(indexData)
                .catch((error) => {
                    cache.delete(scene);
                    throw error;
                });
            cache.set(scene, pending);
        }
        return pending;
    };
    const interactionData = (scene: string) => {
        let pending = interactionCache.get(scene);
        if (!pending) {
            pending = read(`${scene}-interaction-points.json`)
                .then((catalog) => {
                    if (
                        catalog.scene !== scene ||
                        !catalog.source ||
                        !Array.isArray(catalog.points)
                    )
                        throw new Error('Invalid local interaction data');
                    const points = new Map<string, InteractionPoint>();
                    for (const point of catalog.points) {
                        const key = `${point.level}/${point.id}`;
                        if (points.has(key))
                            throw new Error('Ambiguous interaction point');
                        // Retain only route inputs from the much larger source-audit catalog.
                        points.set(key, {
                            id: point.id,
                            level: point.level,
                            position: point.position,
                            template: point.template,
                            templatePath: point.templatePath,
                            navigationGoal: point.navigationGoal,
                            effective: point.effective,
                            navigationUnresolved: point.navigationUnresolved,
                        });
                    }
                    return { scene, source: catalog.source, points };
                })
                .catch((error) => {
                    if (error?.code === 'ENOENT') return null;
                    interactionCache.delete(scene);
                    throw error;
                });
            interactionCache.set(scene, pending);
        }
        return pending;
    };
    const physicalData = () => {
        physical ??= read('physical-route-data.json')
            .then(indexData)
            .catch((error) => {
                physical = undefined;
                if (error?.code === 'ENOENT') return null;
                throw error;
            });
        return physical;
    };
    return {
        name: 'world-local-route-inspection',
        closeBundle: close,
        configureServer(server) {
            server.httpServer?.once('close', close);
            removeCloseListener = () => {
                server.httpServer?.removeListener('close', close);
            };
            const serveLog = async (name: string, response: ServerResponse) => {
                try {
                    if (!directory)
                        throw new Error('Route data is not configured');
                    const text = await readFile(
                        resolve(directory, name),
                        'utf8',
                    );
                    response.setHeader(
                        'Content-Type',
                        'text/plain; charset=utf-8',
                    );
                    response.setHeader('Cache-Control', 'no-store');
                    response.end(text);
                } catch {
                    response.statusCode = 404;
                    response.end('Log is not available yet');
                }
            };
            const logUrl = (file: string | undefined) =>
                file && directory
                    ? `/__routes/log?path=${encodeURIComponent(relative(directory, file))}`
                    : undefined;
            server.middlewares.use('/__routes/logs', (request, response) => {
                if (request.method !== 'GET') {
                    response.statusCode = 405;
                    response.end();
                    return;
                }
                void serveLog('route-jobs.jsonl', response);
            });
            server.middlewares.use('/__routes/log', (request, response) => {
                const name = new URL(
                    request.url ?? '',
                    'http://localhost',
                ).searchParams.get('path');
                if (
                    request.method !== 'GET' ||
                    !name ||
                    !/^player-(?:ground|routes)\/[a-zA-Z0-9_-]+\.json\.progress\.jsonl$/.test(
                        name,
                    )
                ) {
                    response.statusCode = 404;
                    response.end();
                    return;
                }
                void serveLog(name, response);
            });
            server.middlewares.use('/__routes/nearest', (request, response) => {
                let reply = (value: unknown, status = 200) =>
                    send(response, value, status);
                let fallback: Candidate | undefined;
                void (async () => {
                    if (!directory) {
                        reply({
                            status: 'unavailable',
                            category: 'missing-data',
                            message:
                                'Route data is not configured in this environment',
                        });
                        return;
                    }
                    if (request.method !== 'GET') {
                        response.setHeader('Allow', 'GET');
                        reply(
                            {
                                status: 'unavailable',
                                message: 'Only GET requests are supported',
                            },
                            405,
                        );
                        return;
                    }
                    const params = new URL(
                        request.url ?? '',
                        'http://localhost',
                    ).searchParams;
                    const scene = params.get('scene') ?? '',
                        level = params.get('level') ?? '',
                        pointId = params.get('point');
                    const source = {
                        buildGuid: params.get('buildGuid') ?? '',
                        contentHash: params.get('contentHash') ?? '',
                    };
                    const coordinates = ['x', 'y', 'z'].map((key) =>
                        params.get(key),
                    );
                    if (
                        !/^map\d+$/.test(scene) ||
                        !level ||
                        level.length > 100 ||
                        (pointId !== null &&
                            (!pointId || pointId.length > 100)) ||
                        !source.buildGuid ||
                        !source.contentHash ||
                        coordinates.some((v) => v === null || v.trim() === '')
                    ) {
                        reply(
                            {
                                status: 'unavailable',
                                message:
                                    'Route request parameters are incomplete',
                            },
                            400,
                        );
                        return;
                    }
                    const target = coordinates.map(Number);
                    if (!finiteVector(target)) {
                        reply(
                            {
                                status: 'unavailable',
                                message: 'Invalid target coordinates',
                            },
                            400,
                        );
                        return;
                    }
                    const queryKey = JSON.stringify({
                        scene,
                        level,
                        source,
                        target,
                        pointId,
                    });
                    const previous = queries.get(queryKey);
                    let marginIndex = 0;
                    if (previous) {
                        const alreadyDone = previous.done;
                        let answer = await previous.pending;
                        const current = queries.get(queryKey);
                        if (
                            !alreadyDone ||
                            (!previous.progress &&
                                !previous.candidate?.optimizing) ||
                            current !== previous
                        ) {
                            if (current && current !== previous)
                                answer = await current.pending;
                            reply(answer.value, answer.status);
                            return;
                        }
                        fallback = previous.candidate;
                        marginIndex = previous.marginIndex;
                        queries.delete(queryKey);
                    }
                    let finish!: (answer: Answer) => void;
                    const entry: Query = {
                        pending: new Promise<Answer>((resolve) => {
                            finish = resolve;
                        }),
                        done: false,
                        marginIndex,
                        anchorIndex: previous?.anchorIndex ?? 0,
                        corridors: previous?.corridors,
                    };
                    queries.set(queryKey, entry);
                    const deliver = reply;
                    reply = (value, status = 200) => {
                        if (
                            entry.log &&
                            value !== null &&
                            typeof value === 'object'
                        )
                            value = { ...value, log: entry.log };
                        entry.done = true;
                        const progress =
                            value !== null &&
                            typeof value === 'object' &&
                            'status' in value &&
                            value.status === 'building-ground';
                        entry.progress = progress;
                        if (status >= 500) queries.delete(queryKey);
                        finish({ value, status });
                        deliver(value, status);
                        // Identical concurrent queries share one calculation. Terminal results
                        // belong to this immutable development snapshot and stay bounded.
                        for (const [key, cached] of queries) {
                            if (queries.size <= 64) break;
                            if (cached.done) queries.delete(key);
                        }
                    };
                    const indexed = await sceneData(scene),
                        data = indexed.data;
                    if (
                        data.scene !== scene ||
                        !sameSource(source, data.source)
                    ) {
                        reply({
                            status: 'unavailable',
                            category: 'stale-build',
                            message:
                                'Route data does not match the current scene build',
                        });
                        return;
                    }
                    const interactionCatalog = pointId
                        ? await interactionData(scene)
                        : null;
                    if (
                        interactionCatalog &&
                        !sameSource(source, interactionCatalog.source)
                    ) {
                        reply({
                            status: 'unavailable',
                            category: 'stale-build',
                            message:
                                'Interaction data does not match the current scene build',
                        });
                        return;
                    }
                    const pointRules = pointId
                        ? interactionCatalog?.points.get(`${level}/${pointId}`)
                        : undefined;
                    const matchingTransform =
                        pointRules &&
                        finiteVector(pointRules.position) &&
                        Math.hypot(
                            ...pointRules.position.map(
                                (value, axis) => value - target[axis],
                            ),
                        ) <= 1e-3;
                    const goal = matchingTransform
                        ? pointRules.navigationGoal
                        : null;
                    if (
                        goal &&
                        (!finiteVector(goal.position) || !goal.interaction)
                    )
                        throw new Error('Invalid normalized interaction goal');
                    const interaction = {
                        point: pointId,
                        status: goal ? 'source-derived' : 'unresolved',
                        template: pointRules?.template ?? null,
                        templatePath: pointRules?.templatePath ?? null,
                        goal: goal ?? null,
                        unresolved:
                            pointRules && !matchingTransform
                                ? ['point-transform-mismatch']
                                : (pointRules?.navigationUnresolved ??
                                  pointRules?.effective.unresolved ?? [
                                      'interaction-rules-unavailable',
                                  ]),
                    };
                    travel ??= read('travel-points.json').catch((error) => {
                        travel = undefined;
                        throw error;
                    });
                    const anchors = await travel;
                    if (!sameSource(source, anchors.source)) {
                        reply({
                            status: 'unavailable',
                            category: 'stale-build',
                            message:
                                'Teleport data does not match the current scene build',
                        });
                        return;
                    }
                    const candidates = travelArrivals(
                        anchors.points,
                        data.arrivals,
                        scene,
                        level,
                        data.progression === 'fully-enabled',
                        target,
                    );
                    const anchor = candidates[entry.anchorIndex];
                    if (!anchor) {
                        reply({
                            status: 'unavailable',
                            category: 'missing-data',
                            message:
                                'No teleport anchors are available for this level',
                        });
                        return;
                    }
                    const arrival: TravelArrival = {
                        ...anchor,
                        position: [...anchor.position],
                        state: 'available',
                    };
                    const corridorAt = (index = entry.marginIndex) => {
                        if (
                            Math.hypot(
                                ...arrival.position.map(
                                    (v, i) => v - target[i],
                                ),
                            ) <=
                            physicalTileSpan * 2
                        )
                            return undefined;
                        entry.corridors ??= coarseCorridors(
                            data,
                            arrival.position,
                            goal?.position ?? target,
                            physicalTileSpan,
                        );
                        return entry.corridors[
                            Math.min(index, entry.corridors.length - 1)
                        ];
                    };
                    const assumptions = [
                        'All teleport anchors assumed unlocked',
                        'Same-level anchors tried by distance, including industrial bases',
                        'Base scene state 0 and area 0 are assumed',
                        ...(data.progression === 'fully-enabled'
                            ? [
                                  'All traversal devices enabled and powered; controllable passage barriers open',
                              ]
                            : data.progression === 'completed'
                              ? [
                                    'All level tasks assumed completed; resolved wall controls use the selected completed-world snapshot',
                                ]
                              : []),
                        goal
                            ? 'Authored interaction volume applied; runtime interaction availability remains unresolved'
                            : 'Interaction rules unresolved; endpoint uses ground projection only',
                    ];
                    const retain = (
                        message: string,
                        optimizing: boolean,
                        traversal?: unknown,
                    ) => {
                        if (!fallback) return false;
                        const candidate = {
                            ...fallback,
                            log: entry.log ?? fallback.log,
                            optimizing,
                            optimizationMessage: message,
                            ...(traversal
                                ? {
                                      diagnostics: {
                                          ...fallback.diagnostics,
                                          traversal,
                                      },
                                  }
                                : {}),
                        };
                        entry.candidate = candidate;
                        reply(candidate);
                        return true;
                    };
                    const building = (message: string) => {
                        if (retain(message, true)) return;
                        reply({
                            status: 'building-ground',
                            log: entry.log,
                            message,
                            retryAfter: 1000,
                            anchor: {
                                id: anchor.id,
                                position: anchor.position,
                            },
                            assumptions,
                            interaction,
                        });
                    };
                    const nextAnchor = () => {
                        if (entry.anchorIndex + 1 >= candidates.length)
                            return false;
                        entry.anchorIndex++;
                        entry.marginIndex = 0;
                        entry.corridors = undefined;
                        building('Trying another teleport landing…');
                        return true;
                    };
                    const expandCoverage = async () => {
                        const nextIndex = entry.marginIndex + 1;
                        const margin = physicalMargins[nextIndex];
                        if (margin === undefined) return false;
                        const next = await builder.query(
                            scene,
                            source,
                            anchor.position,
                            target,
                            {
                                startBuild: true,
                                margin,
                                corridor: corridorAt(nextIndex),
                            },
                        );
                        if (!next || next.status === 'failed') return false;
                        if (next.log) entry.log = logUrl(next.log);
                        entry.marginIndex = nextIndex;
                        building('Loading a wider route area…');
                        return true;
                    };
                    const job = await builder.query(
                        scene,
                        source,
                        anchor.position,
                        target,
                        {
                            startBuild: false,
                            margin: physicalMargins[entry.marginIndex],
                            corridor: corridorAt(),
                        },
                    );
                    if (job?.log) entry.log = logUrl(job.log);
                    if (
                        job?.status === 'queued' ||
                        job?.status === 'building'
                    ) {
                        building(job.message);
                        return;
                    }
                    let built: IndexedData | undefined;
                    if (job?.status === 'ready') {
                        if (!job.result || typeof job.result !== 'object')
                            throw new Error(
                                'Missing completed physical ground build',
                            );
                        built = builtCache.get(job.result);
                        if (!built) {
                            built = normalizeData(job.result, data);
                            builtCache.set(job.result, built);
                        }
                        if (
                            !built.data.bounds ||
                            !contains(built.data.bounds, anchor.position) ||
                            !contains(built.data.bounds, target)
                        )
                            throw new Error(
                                'Physical ground build does not cover this route',
                            );
                    }
                    const sample = await physicalData();
                    const usePhysical =
                        sample &&
                        sample.data.scene === scene &&
                        sample.data.level === level &&
                        sameSource(source, sample.data.source) &&
                        sample.data.bounds &&
                        contains(sample.data.bounds, anchor.position) &&
                        contains(sample.data.bounds, target);
                    // Built tiles are planned in the extractor child so route polling stays responsive.
                    const attempts = [
                        ...(usePhysical ? [sample] : []),
                        indexed,
                    ];
                    const coverageAttempts: string[] = [];
                    const diagnostics: {
                        coverage: string;
                        margin: number;
                        surfaces: number;
                        walls: number;
                        anchor: Projection;
                        target: Projection;
                        plannerStatus?: string;
                    }[] = [];
                    const publish = (
                        route: Extract<Route, { status: 'complete' }>,
                        selected: Data,
                        coverage: string,
                        traversal?: unknown,
                        optimization?: {
                            status: string;
                            message: string;
                        } | null,
                    ) => {
                        if (fallback && fallback.route.cost <= route.cost) {
                            retain(
                                optimization?.message ?? '',
                                Boolean(
                                    optimization &&
                                        optimization.status !== 'failed',
                                ),
                                traversal,
                            );
                            return;
                        }
                        const candidate = {
                            version: 1,
                            status: 'candidate' as const,
                            scene,
                            level,
                            source,
                            title: 'Teleport → Target',
                            log: entry.log,
                            diagnostics: {
                                anchorCandidates: candidates.length,
                                attempts: diagnostics,
                                traversal,
                            },
                            route,
                            grounding: {
                                requestedTarget: target,
                                groundTarget: route.points.at(-1),
                                heightOffset:
                                    target[1] - route.points.at(-1)![1],
                                method: goal
                                    ? 'source-interaction-volume'
                                    : 'near-surface-or-downward',
                                maximumNearOffset: selected.options.maxVertical,
                                maximumDrop: 4,
                            },
                            markers: [
                                {
                                    label: 'Teleport',
                                    position: route.points[0],
                                },
                                { label: 'Target', position: target },
                            ],
                            coverage,
                            coverageDetails: selected.coverage,
                            ...(traversal
                                ? { motionValidation: 'model-based' }
                                : {}),
                            assumptions: [
                                ...assumptions,
                                ...(route.segments.some(
                                    (segment) => segment.mode === 'rope',
                                )
                                    ? [
                                          'All vertical ropes assumed enabled and unlocked; device motion timing is model-based',
                                      ]
                                    : []),
                                ...(route.segments.some(
                                    (segment) => segment.mode === 'launch',
                                )
                                    ? [
                                          'All launch devices assumed enabled and powered; motion timing is model-based',
                                      ]
                                    : []),
                            ],
                            interaction,
                            anchor: {
                                id: anchor.id,
                                position: anchor.position,
                            },
                            optimizing: Boolean(
                                optimization &&
                                    optimization.status !== 'failed',
                            ),
                            optimizationMessage: optimization?.message ?? '',
                        };
                        entry.candidate = candidate;
                        reply(candidate);
                    };
                    const direction = corridorAt();
                    const routeRequest = {
                        point: pointId,
                        scene,
                        source,
                        arrival,
                        target: goal?.position ?? target,
                        interaction: goal?.interaction,
                        walls: data.options.walls,
                        waypoints: direction
                            ? coarseWaypoints([direction])
                            : undefined,
                    };
                    const walking =
                        job?.status === 'ready'
                            ? await builder.solve(
                                  job,
                                  routeRequest,
                                  false,
                                  'walking',
                              )
                            : null;
                    if (walking?.log) entry.log = logUrl(walking.log);
                    if (
                        walking?.status === 'queued' ||
                        walking?.status === 'building'
                    ) {
                        building(walking.message);
                        return;
                    }
                    const walked = walking?.result as Result | undefined;
                    const device =
                        job?.status === 'ready' &&
                        walked?.status === 'unavailable'
                            ? await builder.solve(
                                  job,
                                  routeRequest,
                                  true,
                                  'devices',
                              )
                            : null;
                    if (device?.log) entry.log = logUrl(device.log);
                    if (
                        device?.status === 'queued' ||
                        device?.status === 'building'
                    ) {
                        building(device.message);
                        return;
                    }
                    const known = (device?.result ?? walked) as
                        | Result
                        | undefined;
                    const motion =
                        job?.status === 'ready' && walking?.status === 'ready'
                            ? await builder.solve(job, routeRequest, true)
                            : null;
                    if (motion?.log) entry.log = logUrl(motion.log);
                    if (
                        motion?.status === 'queued' ||
                        motion?.status === 'building'
                    ) {
                        const provisional = (motion.result ?? known) as
                            | Result
                            | undefined;
                        if (
                            built &&
                            provisional?.scene === scene &&
                            provisional.source &&
                            sameSource(source, provisional.source) &&
                            provisional.status === 'candidate' &&
                            provisional.route?.status === 'complete'
                        ) {
                            publish(
                                provisional.route,
                                built.data,
                                'Physical collision ground · Known movement route',
                                provisional.diagnostics,
                                { status: 'building', message: motion.message },
                            );
                            return;
                        }
                        building(motion.message);
                        return;
                    }
                    if (motion?.status === 'ready' && built) {
                        const result = motion.result as {
                            scene: string;
                            source: Source;
                            status: string;
                            route?: Route;
                            diagnostics?: unknown;
                            reason?: string;
                        };
                        if (
                            !result ||
                            result.scene !== scene ||
                            !sameSource(source, result.source)
                        )
                            throw new Error(
                                'Physical route does not match this scene build',
                            );
                        if (
                            result.status === 'candidate' &&
                            result.route?.status === 'complete'
                        ) {
                            publish(
                                result.route,
                                built.data,
                                'Physical collision ground with model-based device, jump and drop actions',
                                result.diagnostics,
                            );
                        } else if (result.status === 'unavailable') {
                            if (
                                retain(
                                    'Jump search completed without a faster covered route',
                                    false,
                                    result.diagnostics,
                                )
                            )
                                return;
                            const arrivalFailed =
                                result.reason === 'arrival-unmapped' ||
                                result.reason === 'arrival-unavailable';
                            if (!arrivalFailed && (await expandCoverage()))
                                return;
                            if (nextAnchor()) return;
                            reply({
                                status: 'unavailable',
                                category: arrivalFailed
                                    ? 'projection-anchor'
                                    : 'movement-coverage',
                                message: arrivalFailed
                                    ? 'Teleport landing could not be placed on supported ground'
                                    : 'No route found within the current ground and movement search',
                                diagnostics: {
                                    traversal: result.diagnostics,
                                    physicalMargins: physicalMargins.slice(
                                        0,
                                        entry.marginIndex + 1,
                                    ),
                                },
                                assumptions,
                                interaction,
                                anchor: {
                                    id: anchor.id,
                                    position: anchor.position,
                                },
                                coverageDetails: built.data.coverage,
                            });
                        } else
                            throw new Error(
                                'Invalid completed physical route result',
                            );
                        return;
                    }
                    const failed =
                        walking?.status === 'failed' ? walking : motion;
                    if (failed?.status === 'failed') {
                        if (
                            retain(
                                'Jump optimization could not finish; the current route is retained',
                                false,
                            )
                        )
                            return;
                        if (nextAnchor()) return;
                        reply({
                            status: 'unavailable',
                            category: 'movement-solver-error',
                            log: entry.log,
                            message: failed.message,
                            assumptions,
                            interaction,
                            anchor: {
                                id: anchor.id,
                                position: anchor.position,
                            },
                        });
                        return;
                    }
                    for (const selected of fallback ? [] : attempts) {
                        const coverage =
                            selected === sample
                                ? 'Physical collision ground sample; incomplete player coverage'
                                : 'AI NavMesh base state / area 0; incomplete player coverage';
                        coverageAttempts.push(coverage);
                        let previousCount = -1;
                        for (const margin of [64, 128, 256]) {
                            const bounds: Bounds = {
                                min: [
                                    Math.min(anchor.position[0], target[0]) -
                                        margin,
                                    Math.min(anchor.position[2], target[2]) -
                                        margin,
                                ],
                                max: [
                                    Math.max(anchor.position[0], target[0]) +
                                        margin,
                                    Math.max(anchor.position[2], target[2]) +
                                        margin,
                                ],
                            };
                            const occupied: Bounds = {
                                min: [Infinity, Infinity],
                                max: [-Infinity, -Infinity],
                            };
                            const surfaces = selected.data.surfaces.filter(
                                (_, i) => {
                                    const offset = i * 4;
                                    const included =
                                        selected.bounds[offset] <=
                                            bounds.max[0] &&
                                        selected.bounds[offset + 2] >=
                                            bounds.min[0] &&
                                        selected.bounds[offset + 1] <=
                                            bounds.max[1] &&
                                        selected.bounds[offset + 3] >=
                                            bounds.min[1];
                                    if (included) {
                                        occupied.min[0] = Math.min(
                                            occupied.min[0],
                                            selected.bounds[offset],
                                        );
                                        occupied.min[1] = Math.min(
                                            occupied.min[1],
                                            selected.bounds[offset + 1],
                                        );
                                        occupied.max[0] = Math.max(
                                            occupied.max[0],
                                            selected.bounds[offset + 2],
                                        );
                                        occupied.max[1] = Math.max(
                                            occupied.max[1],
                                            selected.bounds[offset + 3],
                                        );
                                    }
                                    return included;
                                },
                            );
                            // Keep exclusions that can touch retained polygons, including their portions outside the crop.
                            const walls = selected.data.options.walls.filter(
                                (wall) => {
                                    const clearance =
                                        selected.data.options.profile.radius +
                                        (wall.padding ?? 0);
                                    return intersects(occupied, {
                                        min: [
                                            wall.min[0] - clearance,
                                            wall.min[2] - clearance,
                                        ],
                                        max: [
                                            wall.max[0] + clearance,
                                            wall.max[2] + clearance,
                                        ],
                                    });
                                },
                            );
                            if (
                                !surfaces.length ||
                                surfaces.length === previousCount
                            )
                                continue;
                            previousCount = surfaces.length;
                            const anchorProjection = projection(
                                surfaces,
                                arrival.position,
                                selected.data.options.maxVertical,
                                'nearest',
                            );
                            const standing =
                                goal && !anchorProjection.mapped
                                    ? (projectGoal(surfaces, goal.position, {
                                          maxVertical:
                                              selected.data.options.maxVertical,
                                          interaction: goal.interaction,
                                      })[0] ?? null)
                                    : null;
                            const targetProjection: Projection = goal
                                ? {
                                      mapped: standing !== null,
                                      heightOffset: standing
                                          ? target[1] - standing.position[1]
                                          : null,
                                      position: standing?.position ?? null,
                                      nearestBelowOffset: null,
                                  }
                                : projection(
                                      surfaces,
                                      target,
                                      selected.data.options.maxVertical,
                                      'near-or-below',
                                  );
                            const attempt = {
                                coverage,
                                margin,
                                surfaces: surfaces.length,
                                walls: walls.length,
                                anchor: anchorProjection,
                                target: targetProjection,
                                plannerStatus: 'unmapped',
                            };
                            diagnostics.push(attempt);
                            const destination =
                                goal?.position ?? targetProjection.position;
                            if (!anchorProjection.mapped || !destination)
                                continue;
                            const retained = new Set(
                                surfaces.map((surface) => surface.id),
                            );
                            const portals =
                                selected.data.options.portals?.filter(
                                    (portal) =>
                                        retained.has(portal.from) &&
                                        retained.has(portal.to),
                                );
                            const options = {
                                ...selected.data.options,
                                walls,
                                portals,
                            };
                            const planner = createGroundPlanner(
                                surfaces,
                                options,
                            );
                            const route = planner.plan(
                                [arrival],
                                destination,
                                goal
                                    ? { interaction: goal.interaction }
                                    : undefined,
                            );
                            attempt.plannerStatus = route.status;
                            // With the arrival already mapped, an unmapped query means no eligible goal surface.
                            if (goal) {
                                targetProjection.mapped =
                                    route.status !== 'unmapped';
                                if (route.status === 'complete') {
                                    targetProjection.position =
                                        route.points.at(-1)!;
                                    targetProjection.heightOffset =
                                        target[1] -
                                        targetProjection.position[1];
                                }
                            }
                            if (route.status !== 'complete') continue;
                            const next = await builder.query(
                                scene,
                                source,
                                anchor.position,
                                target,
                                {
                                    startBuild: true,
                                    margin: physicalMargins[entry.marginIndex],
                                    corridor: corridorAt(),
                                },
                            );
                            const optimization =
                                next?.status === 'ready'
                                    ? await builder.solve(
                                          next,
                                          routeRequest,
                                          true,
                                          'walking',
                                      )
                                    : next;
                            publish(
                                route,
                                selected.data,
                                coverage,
                                undefined,
                                optimization,
                            );
                            return;
                        }
                    }
                    const nextJob = await builder.query(
                        scene,
                        source,
                        anchor.position,
                        target,
                        {
                            startBuild: true,
                            margin: physicalMargins[entry.marginIndex],
                            corridor: corridorAt(),
                        },
                    );
                    if (nextJob?.log) entry.log = logUrl(nextJob.log);
                    if (
                        nextJob?.status === 'queued' ||
                        nextJob?.status === 'building'
                    ) {
                        building(nextJob.message);
                        return;
                    }
                    // A disk-cached result can become ready on the first build request.
                    // Let the next poll run that physical data through the normal planner.
                    if (!built && nextJob?.status === 'ready') {
                        building(nextJob.message);
                        return;
                    }
                    if (built && nextJob?.status === 'ready') {
                        const solving = await builder.solve(
                            nextJob,
                            routeRequest,
                            true,
                            'walking',
                        );
                        if (solving) {
                            building(solving.message);
                            return;
                        }
                    }
                    if (
                        retain(
                            'Jump optimization could not finish; the current route is retained',
                            false,
                        )
                    )
                        return;
                    if (nextJob?.status === 'failed' && nextAnchor()) return;
                    const best = diagnostics.toSorted(
                        (a, b) =>
                            Number(b.anchor.mapped) +
                            Number(b.target.mapped) -
                            Number(a.anchor.mapped) -
                            Number(a.target.mapped),
                    )[0];
                    const category = !best
                        ? 'missing-data'
                        : !best.anchor.mapped
                          ? 'projection-anchor'
                          : !best.target.mapped
                            ? 'projection-target'
                            : 'disconnected-ground';
                    const messages = {
                        'missing-data':
                            'No ground surfaces are covered in the requested region',
                        'projection-anchor':
                            'The nearest teleport has no matching ground surface',
                        'projection-target': goal
                            ? 'The target has no ground within its interaction volume'
                            : 'The target has no matching ground surface',
                        'disconnected-ground':
                            'The nearest teleport and target have no covered ground connection',
                    };
                    reply({
                        status: 'unavailable',
                        category:
                            nextJob?.status === 'failed'
                                ? 'physical-build-failed'
                                : category,
                        diagnostics: {
                            anchorCandidates: candidates.length,
                            attempts: diagnostics,
                        },
                        message:
                            nextJob?.status === 'failed'
                                ? nextJob.message
                                : messages[category],
                        groundFailure: category,
                        anchor: { id: anchor.id, position: anchor.position },
                        coverage: coverageAttempts.join(' / '),
                        coverageDetails: built?.data.coverage,
                        assumptions,
                        interaction,
                    });
                })().catch((error) => {
                    const missing = error?.code === 'ENOENT';
                    server.config.logger.error(
                        `Local route inspection failed: ${error instanceof Error ? error.message : String(error)}`,
                    );
                    if (fallback) {
                        reply({
                            ...fallback,
                            optimizing: false,
                            optimizationMessage:
                                'Jump optimization could not finish; the current route is retained',
                        });
                        return;
                    }
                    reply(
                        {
                            status: 'unavailable',
                            category: missing ? 'missing-data' : 'solver-error',
                            message: missing
                                ? 'Route data for this scene is not installed'
                                : 'Could not load route data or solve the route',
                        },
                        missing ? 200 : 500,
                    );
                });
            });
        },
    };
}
