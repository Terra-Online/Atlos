import { candidateJobs, type CandidateJob } from './candidate-job.ts';
import type { createWindowRoute } from './window-route.ts';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { selectTerminal, joinTerminal, type Terminal, type Catalog as TerminalCatalog } from './terminal-routes.ts';
import { resolve } from 'node:path';
import type { ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { supportBoxes, type SupportBox } from './src/moving-bounds.ts';
import {
    type GroundArrival,
    type GroundOptions,
    type LocomotionOptions,
    type InteractionGoal,
    type Route,
    type Surface,
    type Vec3,
} from '@opendfieldmap/ganglia';
import { physicalRouteBuilder } from './physical-route-builder.ts';

import {
    travelArrivals,
    type TravelPoint,
} from './travel-arrivals.ts';

type Source = { buildGuid: string; contentHash: string };
type Bounds = { min: [number, number]; max: [number, number] };
type Data = {
    generator?: string;
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
type WindowQuery = { physicalFailure?: { reason: string; diagnostics: unknown }; attempts: number; excludedEdges: (number | string)[]; excludedArrivals: string[]; job: CandidateJob; window?: ReturnType<typeof createWindowRoute>; tailDone?: boolean; partial?: Candidate };
type Query = {
    windows?: WindowQuery;
    pending: Promise<Answer>;
    done: boolean;
    progress?: boolean;
    log?: string;
    candidate?: Candidate;
};

const finiteVector = (value: unknown): value is Vec3 =>
    Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const sameSource = (a: Source, b: Source) =>
    a.buildGuid === b.buildGuid && a.contentHash === b.contentHash;
const indexData = (data: Data): IndexedData => {
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
    } = {},
): Plugin {
    const cache = new Map<string, Promise<IndexedData>>();
    const builder = physicalRouteBuilder({ ...build, directory });
    const globalJobs = candidateJobs(directory, build.node);
    let travel: Promise<{ source: Source; points: TravelPoint[] }> | undefined;
    let terminalCatalog: Promise<TerminalCatalog|null> | undefined;
    let movementHash: Promise<string> | undefined;
    const interactionCache = new Map<
        string,
        Promise<InteractionCatalog | null>
    >();
    const queries = new Map<string, Query>();
    let removeCloseListener = () => {};
    const close = async () => {
        globalJobs.close();
        const drained = builder.close();
        cache.clear();
        interactionCache.clear();
        queries.clear();
        travel = undefined;
        terminalCatalog = undefined; movementHash = undefined;
        removeCloseListener();
        await drained;
    };
    const read = async <T = unknown>(name: string): Promise<T> =>
        JSON.parse(await readFile(resolve(directory!, name), 'utf8')) as T;
    const sceneData = (scene: string) => {
        let pending = cache.get(scene);
        if (!pending) {
            pending = read<Data>(`${scene}-ground-all.json`)
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
            pending = read<{ scene: string; source: Source; points: InteractionPoint[] }>(`${scene}-interaction-points.json`)
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
                    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
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
            const closeListener = () => { void close(); };
            server.httpServer?.once('close', closeListener);
            removeCloseListener = () => {
                server.httpServer?.removeListener('close', closeListener);
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
                if (request.method !== 'GET') { response.statusCode = 405; response.end(); return; }
                void read('route-preview-current.json').then(value => send(response, value))
                    .catch(() => send(response, { message: 'Route preview is not ready' }, 404));
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
                        queries.delete(queryKey);
                    }
                    let finish!: (answer: Answer) => void;
                    const entry: Query = {
                        pending: new Promise<Answer>((resolve) => {
                            finish = resolve;
                        }),
                        done: false,
                        windows: previous?.windows,
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
                    const normalizedGoal = matchingTransform
                        ? pointRules.navigationGoal
                        : null;
                    // Collection triggers can be entered during flight. Preserve
                    // their source-derived volume and finish at the collection event.
                    const goal = normalizedGoal && pointRules?.template?.startsWith('int_collection_coin')
                        ? { ...normalizedGoal, interaction: { ...normalizedGoal.interaction, airborne: true } }
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
                    travel ??= read<{ source: Source; points: TravelPoint[] }>('travel-points.json').catch((error) => {
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
                        reply({ status: 'unavailable', category: 'missing-data', message: 'No teleport anchors are available for this scene' });
                        return;
                    }
                    let terminal:Terminal|null=null;
                    if(goal?.interaction.airborne){
                        terminalCatalog ??= read<TerminalCatalog>('terminal-routes.json').catch(error=>{
                            if((error as NodeJS.ErrnoException)?.code==='ENOENT') return null;
                            terminalCatalog=undefined; throw error;
                        });
                        const catalog=await terminalCatalog;
                        if(catalog){
                            movementHash ??= readFile(resolve(directory,'movement-settings-current.json')).then(bytes=>
                                createHash('sha256').update(bytes).digest('hex'));
                            terminal=selectTerminal(catalog,{scene,source,generator:data.generator,
                                solver:build.solver,movementHash:await movementHash,target:goal.position,interaction:goal.interaction,
                                arrivals:candidates,speed:data.options.locomotion?.sprintSpeed??data.options.speed});
                        }
                    }
                    const planningTarget=terminal?.route.points[0]??goal?.position??target;
                    // Every distance uses one global candidate and bounded physical windows.
                    entry.windows ??= { attempts: 1, excludedEdges: [], excludedArrivals: [], job: globalJobs.start({ scene, source, arrivals: candidates,
                        target: planningTarget }) };
                    const windowQuery = entry.windows;
                    const pendingWindows = (message: string) => {
                        if (windowQuery.partial) {
                            entry.candidate = { ...windowQuery.partial, optimizing: true, optimizationMessage: message };
                            reply(entry.candidate);
                        } else reply({ status: 'building-ground', message, retryAfter: 1000 });
                    };
                    if (windowQuery.job.status === 'pending') {
                        pendingWindows('Finding a global route corridor…');
                        return;
                    }
                    const stopWindows = (reason: string, diagnostics?: unknown) => {
                        if (windowQuery.partial) {
                            entry.candidate = { ...windowQuery.partial, optimizing: false, optimizationMessage: reason };
                            reply(entry.candidate);
                        } else reply({ status: 'unavailable', category: windowQuery.physicalFailure ? 'window-route' : 'candidate-search',
                            message: windowQuery.physicalFailure?.reason ?? reason, diagnostics: windowQuery.physicalFailure?.diagnostics ?? diagnostics });
                    };
                    if (windowQuery.job.status === 'failed') {
                        stopWindows(windowQuery.job.error ?? 'Candidate search failed');
                        return;
                    }
                    const global = windowQuery.job.result!;
                    if (!global.points?.length) {
                        stopWindows(global.reason ?? 'No global route corridor found', global.diagnostics);
                        return;
                    }
                    const selectedArrival = global.arrival;
                    if (!selectedArrival) throw new Error('Candidate route omitted its arrival');
                    if (!windowQuery.window) {
                        const movement = await read<{ source: Source; sustainedSprint: LocomotionOptions }>('movement-settings-current.json');
                        if (!sameSource(source, movement.source)) throw new Error('Movement settings do not match scene build');
                        windowQuery.window = builder.windows({ point: pointId, scene, source, arrival: selectedArrival,
                            target: planningTarget, interaction: terminal?undefined:goal?.interaction, walls: data.options.walls },
                            global.points, { maxTiles: 16, margin: 8, locomotion: movement.sustainedSprint,
                                transfers: global.path?.filter(edge => edge.unresolved).map(edge => edge.points) });
                    }
                    const publishWindow = (route: Extract<Route, { status: 'complete' }>, partial: boolean, diagnostics: unknown, evidence: unknown[]) => {
                        const contacts = evidence.flatMap(item => supportBoxes((item as { supportBoxes?: unknown })?.supportBoxes));
                        const result = { version: 1, supportBoxes: contacts, status: 'candidate' as const, scene, level, source, route, partial,
                            title: partial ? 'Target approach · Partial route' : 'Teleport → Target',
                            markers: [{ label: partial ? 'Local approach start' : 'Teleport', position: route.points[0] },
                                { label: 'Target', position: target }],
                            coverage: partial ? 'Verified target-side window; teleport approach pending' : 'Verified physical route windows',
                            diagnostics: { anchorCandidates: candidates.length, traversal: diagnostics },
                            anchor: { id: selectedArrival.id, position: selectedArrival.position }, interaction,
                            optimizing: partial, optimizationMessage: partial ? 'Connecting the teleport approach…' : '',
                            assumptions: ['All tasks completed; devices enabled and powered'],
                        };
                        entry.candidate = result;
                        if (partial) windowQuery.partial = result;
                        reply(result);
                    };
                    if (!windowQuery.tailDone) {
                        if(terminal){
                            windowQuery.tailDone=true;
                            publishWindow(terminal.route,true,{terminalAsset:terminal.id},[{supportBoxes:terminal.supportBoxes??[]}]);
                            return;
                        }
                        const tail = await windowQuery.window.advanceTail();
                        if (tail.status === 'partial') {
                            windowQuery.tailDone = true;
                            publishWindow(tail.route, true, { global: global.diagnostics, partial: true }, tail.evidence);
                            return;
                        }
                        if (tail.status === 'pending') {
                            pendingWindows('Validating the target approach…');
                            return;
                        }
                        windowQuery.tailDone = true;
                    }
                    const windowResult = await windowQuery.window.advance();
                    if (windowResult.status === 'complete') {
                        const route=terminal?joinTerminal(windowResult.route,terminal.route,(await read<{ source: Source; sustainedSprint: LocomotionOptions }>('movement-settings-current.json')).sustainedSprint):windowResult.route;
                        if(route.status!=='complete'){
                            stopWindows('Terminal entry or resource schedule changed; the verified target approach is retained');
                            return;
                        }
                        publishWindow(route, false, { global: global.diagnostics, windows: windowResult.pieces.length,
                            ...(terminal?{terminalAsset:terminal.id}:{}) }, [...windowResult.evidence,...(terminal?[{supportBoxes:terminal.supportBoxes??[]}]:[])]);
                    } else if (windowResult.status === 'pending') {
                        pendingWindows(`Connecting route windows (${windowResult.completedWindows} complete)…`);
                    } else {
                        // Reject only this query's failed transfer. Other targets can still
                        // use the shared prepared graph and its untested alternatives.
                        windowQuery.physicalFailure = { reason: windowResult.reason ?? 'no-verified-route', diagnostics: windowResult };
                        const local = windowResult.window.points;
                        const edge = global.path?.find(edge => edge.unresolved &&
                            !windowQuery.excludedEdges.includes(edge.key ?? edge.index) && edge.points.some(point =>
                                local.some(candidate => Math.hypot(...point.map((value, axis) => value - candidate[axis])) < 1e-5)));
                        if (edge) windowQuery.excludedEdges.push(edge.key ?? edge.index);
                        else windowQuery.excludedArrivals.push(selectedArrival.id);
                        const alternatives = candidates.filter(candidate => !windowQuery.excludedArrivals.includes(candidate.id));
                        if (windowQuery.attempts < 6 && alternatives.length) {
                            windowQuery.attempts++;
                            windowQuery.job = globalJobs.start({ scene, source, arrivals: alternatives,
                                target: planningTarget, excludedEdges: windowQuery.excludedEdges });
                            windowQuery.window = undefined;
                            windowQuery.tailDone = Boolean(windowQuery.partial);
                            pendingWindows('Checking an alternative route after a failed physical window…');
                        } else if (windowQuery.partial) {
                            stopWindows(`Teleport approach incomplete after ${windowQuery.attempts} candidates: ${windowResult.reason}`);
                        } else reply({ status: 'unavailable', category: 'window-route', message: windowResult.reason,
                            diagnostics: { ...windowResult, candidateAttempts: windowQuery.attempts, candidateBudget: 6 } });
                    }
                    return;
                })().catch((error) => {
                    const missing = (error as NodeJS.ErrnoException)?.code === 'ENOENT';
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
