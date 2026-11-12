import { candidateJobs } from './candidate-job.ts';
import { setTimeout as delay } from 'node:timers/promises';
import {
    prepareRouteSolver,
    gangliaV1Defaults,
    type RouteResult,
    type SceneResources,
} from '@opendfieldmap/ganglia/solver';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
    matchingTerminals,
    type Catalog as TerminalCatalog,
} from './terminal-routes.ts';
import { resolve } from 'node:path';
import type { ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { supportBoxes, type SupportBox } from './src/moving-bounds.ts';
import {
    type GroundArrival,
    type GroundOptions,
    type InteractionGoal,
    type LocomotionOptions,
    type Route,
    type Surface,
    type Vec3,
} from '@opendfieldmap/ganglia';
import { physicalRouteBuilder } from './physical-route-builder.ts';

import { travelArrivals, type TravelPoint } from './travel-arrivals.ts';

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
type IndexedData = { data: Data };

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
type Candidate = {
    log?: string;
    status: 'candidate';
    route: Extract<Route, { status: 'complete' }>;
    supportBoxes?: SupportBox[];
    partial?: boolean;
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
    latest?: Answer;
    done: boolean;
    progress?: boolean;
    candidate?: Candidate;
};

const finiteVector = (value: unknown): value is Vec3 =>
    Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const sameSource = (a: Source, b: Source) =>
    a.buildGuid === b.buildGuid && a.contentHash === b.contentHash;
const indexData = (value: unknown): IndexedData => {
    // The envelope is checked here; Ganglia validates the exported geometry.
    const data = value as Data;
    if (
        !data.source ||
        !Array.isArray(data.surfaces) ||
        !Array.isArray(data.arrivals) ||
        !data.options ||
        !Array.isArray(data.options.walls)
    )
        throw new Error('Invalid local routing data');
    return { data };
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
        sceneBinding?: (
            scene: string,
        ) => Promise<{ generation: string; source: Source }>;
    } = {},
): Plugin {
    const cache = new Map<string, Promise<IndexedData>>();
    const builder = physicalRouteBuilder({ ...build, directory });
    const globalJobs = candidateJobs(directory, build.node);
    let travel: Promise<{ source: Source; points: TravelPoint[] }> | undefined;
    let terminalCatalog: Promise<TerminalCatalog | null> | undefined;
    let movementHash: Promise<string> | undefined;
    const interactionCache = new Map<
        string,
        Promise<InteractionCatalog | null>
    >();
    const queries = new Map<string, Query>();
    let removeCloseListener = () => {};
    const shutdown = new AbortController();
    const running = new Set<Promise<unknown>>();
    const close = async () => {
        shutdown.abort();
        globalJobs.close();
        const drained = builder.close();
        cache.clear();
        interactionCache.clear();
        queries.clear();
        travel = undefined;
        terminalCatalog = undefined;
        movementHash = undefined;
        removeCloseListener();
        await Promise.allSettled(running);
        await drained;
    };
    const read = async (name: string): Promise<unknown> =>
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
                .then((value) => {
                    const catalog = value as {
                        scene: string;
                        source: Source;
                        points: InteractionPoint[];
                    };
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
                .catch((error: unknown) => {
                    if (
                        error instanceof Error &&
                        'code' in error &&
                        error.code === 'ENOENT'
                    )
                        return null;
                    interactionCache.delete(scene);
                    throw error;
                });
            interactionCache.set(scene, pending);
        }
        return pending;
    };
    return {
        name: 'world-local-route-inspection',
        closeBundle: close,
        configureServer(server) {
            const onClose = () => {
                void close().catch((error: unknown) =>
                    server.config.logger.error(
                        `Route cleanup failed: ${String(error)}`,
                    ),
                );
            };
            server.httpServer?.once('close', onClose);
            removeCloseListener = () => {
                server.httpServer?.removeListener('close', onClose);
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
            server.middlewares.use('/__routes/preview', (request, response) => {
                if (request.method !== 'GET') {
                    response.statusCode = 405;
                    response.end();
                    return;
                }
                void read('route-preview-current.json')
                    .then((value) => send(response, value))
                    .catch(() =>
                        send(
                            response,
                            { message: 'Route preview is not ready' },
                            404,
                        ),
                    );
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
                    const generation = params.get('generation'),
                        state = params.get('state');
                    if (!build.sceneBinding) {
                        reply(
                            {
                                status: 'unavailable',
                                category: 'missing-data',
                                message:
                                    'Scene resource binding is not configured',
                            },
                            503,
                        );
                        return;
                    }
                    const binding = await build.sceneBinding(scene);
                    if (
                        generation !== binding.generation ||
                        state !== 'fully-enabled' ||
                        !sameSource(source, binding.source)
                    ) {
                        reply(
                            {
                                status: 'unavailable',
                                category: sameSource(source, binding.source)
                                    ? 'stale-scene'
                                    : 'stale-build',
                                message:
                                    'Route query does not match the supported scene generation and fully enabled state',
                            },
                            409,
                        );
                        return;
                    }
                    const boundReply = reply;
                    reply = (value, status) =>
                        boundReply(
                            value && typeof value === 'object'
                                ? { ...value, generation, state }
                                : value,
                            status,
                        );
                    const queryKey = JSON.stringify({
                        generation,
                        state,
                        scene,
                        level,
                        source,
                        target,
                        pointId,
                    });
                    const previous = queries.get(queryKey);
                    response.setHeader(
                        'X-Route-Cache',
                        previous?.done &&
                            !previous.progress &&
                            !previous.candidate?.optimizing
                            ? 'result'
                            : previous
                              ? 'in-flight'
                              : 'miss',
                    );
                    if (previous) {
                        const answer =
                            previous.latest ?? (await previous.pending);
                        reply(answer.value, answer.status);
                        return;
                    }
                    let finish!: (answer: Answer) => void;
                    const entry: Query = {
                        pending: new Promise<Answer>((resolve) => {
                            finish = resolve;
                        }),
                        done: false,
                    };
                    queries.set(queryKey, entry);
                    const deliver = reply;
                    let delivered = false;
                    reply = (value, status = 200) => {
                        const progress =
                            value !== null &&
                            typeof value === 'object' &&
                            'status' in value &&
                            value.status === 'building-ground';
                        entry.progress = progress;
                        if (status >= 500) queries.delete(queryKey);
                        entry.done = !progress && !entry.candidate?.optimizing;
                        entry.latest = { value, status };
                        if (!delivered) {
                            delivered = true;
                            finish(entry.latest);
                            deliver(value, status);
                        }
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
                    const normalizedGoal = matchingTransform
                        ? pointRules.navigationGoal
                        : null;
                    // Collection triggers can be entered during flight. Preserve
                    // their source-derived volume and finish at the collection event.
                    const goal =
                        normalizedGoal &&
                        pointRules?.template?.startsWith('int_collection_coin')
                            ? {
                                  ...normalizedGoal,
                                  interaction: {
                                      ...normalizedGoal.interaction,
                                      airborne: true,
                                  },
                              }
                            : normalizedGoal;
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
                    travel ??= read('travel-points.json')
                        .then(
                            (value) =>
                                value as {
                                    source: Source;
                                    points: TravelPoint[];
                                },
                        )
                        .catch((error: unknown) => {
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
                        undefined,
                        data.progression === 'fully-enabled',
                        target,
                    );
                    if (!candidates.length) {
                        reply({
                            status: 'unavailable',
                            category: 'missing-data',
                            message:
                                'No teleport anchors are available for this scene',
                        });
                        return;
                    }
                    const movement = (await read(
                        'movement-settings-current.json',
                    )) as {
                        source: Source;
                        sustainedSprint: LocomotionOptions;
                    };
                    if (!sameSource(source, movement.source))
                        throw new Error(
                            'Movement settings do not match scene build',
                        );
                    const resources: SceneResources<
                        Source,
                        Awaited<ReturnType<typeof builder.query>> & {}
                    > = {
                        query: builder.query,
                        solve: builder.solve,
                        key: (job) => job.output,
                        ground: async (job) =>
                            JSON.parse(await readFile(job.output, 'utf8')) as {
                                surfaces: Surface[];
                                options: GroundOptions;
                            },
                        route: (job) =>
                            job.result as { route?: Route; reason?: string },
                        wait: async (signal) => {
                            if (!signal?.aborted)
                                await delay(25, undefined, { signal }).catch(
                                    (error) => {
                                        if (!signal?.aborted) throw error;
                                    },
                                );
                        },
                        plan: async (starts, target, excludedEdges, signal) => {
                            const job = globalJobs.start({
                                scene,
                                source,
                                arrivals: starts,
                                target,
                                excludedEdges,
                            });
                            while (job.status === 'pending' && !signal?.aborted)
                                await resources.wait(signal);
                            if (signal?.aborted) return { status: 'cancelled' };
                            if (job.status === 'failed')
                                throw new Error(
                                    job.error ?? 'Candidate search failed',
                                );
                            if (!job.result)
                                throw new Error(
                                    'Candidate worker omitted result',
                                );
                            return job.result;
                        },
                        terminals: async (query) => {
                            terminalCatalog ??= read('terminal-routes.json')
                                .then((value) => value as TerminalCatalog)
                                .catch((error: unknown) => {
                                    if (
                                        error instanceof Error &&
                                        'code' in error &&
                                        error.code === 'ENOENT'
                                    )
                                        return null;
                                    terminalCatalog = undefined;
                                    throw error;
                                });
                            movementHash ??= readFile(
                                resolve(
                                    directory,
                                    'movement-settings-current.json',
                                ),
                            ).then((bytes) =>
                                createHash('sha256')
                                    .update(bytes)
                                    .digest('hex'),
                            );
                            return matchingTerminals(await terminalCatalog, {
                                scene,
                                source,
                                generator: (
                                    data as Data & { generator?: string }
                                ).generator,
                                solver: build.solver,
                                movementHash: await movementHash,
                                target: query.goal,
                                interaction: query.interaction,
                            });
                        },
                    };
                    const solver = await prepareRouteSolver(
                        gangliaV1Defaults,
                        {
                            kind: 'scene',
                            scene: { scene, source, walls: data.options.walls },
                            resources,
                            locomotion: movement.sustainedSprint,
                        },
                    );
                    const display = (
                        result: RouteResult,
                        optimizing: boolean,
                        message = '',
                    ) => {
                        if (result.route.status !== 'complete') return;
                        const route = result.route,
                            partial = result.partial === true;
                        const candidate = {
                            version: 1,
                            status: 'candidate' as const,
                            scene,
                            level,
                            source,
                            route,
                            partial,
                            supportBoxes: supportBoxes(result.supportBoxes),
                            title: partial
                                ? 'Target approach · Partial route'
                                : 'Teleport → Target',
                            markers: [
                                {
                                    label: partial
                                        ? 'Local approach start'
                                        : 'Teleport',
                                    position: route.points[0],
                                },
                                { label: 'Target', position: target },
                            ],
                            coverage: partial
                                ? 'Verified target-side window; teleport approach pending'
                                : 'Verified physical route windows',
                            diagnostics: {
                                anchorCandidates: candidates.length,
                                traversal: result.diagnostics,
                            },
                            anchor: result.arrival,
                            interaction,
                            optimizing,
                            optimizationMessage: message,
                            assumptions: [
                                'All tasks completed; devices enabled and powered',
                            ],
                        };
                        entry.candidate = candidate;
                        fallback = candidate;
                        reply(candidate);
                    };
                    try {
                        const solving = solver.solve(
                            {
                                starts: candidates,
                                goal: goal?.position ?? target,
                                interaction: goal?.interaction,
                            },
                            {
                                signal: shutdown.signal,
                                onEvent: (event) => {
                                    if (event.type === 'candidate')
                                        display(event.result, event.optimizing);
                                    else if (entry.candidate) {
                                        entry.candidate = {
                                            ...entry.candidate,
                                            optimizing: true,
                                            optimizationMessage:
                                                'Connecting the route…',
                                        };
                                        reply(entry.candidate);
                                    } else
                                        reply({
                                            status: 'building-ground',
                                            message:
                                                'Finding and validating route corridors…',
                                            retryAfter: 1000,
                                        });
                                },
                            },
                        );
                        running.add(solving);
                        let result: RouteResult;
                        try {
                            result = await solving;
                        } finally {
                            running.delete(solving);
                        }
                        if (result.route.status === 'complete')
                            display(result, false, result.reason);
                        else {
                            entry.candidate = undefined;
                            reply({
                                status: 'unavailable',
                                category:
                                    result.reason === 'no-global-candidate'
                                        ? 'candidate-search'
                                        : 'window-route',
                                message: result.reason,
                                diagnostics: result.diagnostics,
                            });
                        }
                    } finally {
                        await solver.close();
                    }
                    return;
                })().catch((error: unknown) => {
                    const missing =
                        error instanceof Error &&
                        'code' in error &&
                        error.code === 'ENOENT';
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
