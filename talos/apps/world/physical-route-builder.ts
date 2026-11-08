import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import {
    appendFile,
    mkdir,
    readFile,
    rename,
    unlink,
    writeFile,
} from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { InteractionGoal, Vec3, Wall } from '@opendfieldmap/ganglia';
import type { TravelArrival } from './travel-arrivals.ts';
import type { Corridor } from './coarse-route.ts';
import { createRouteWorker } from './route-worker.ts';

type Source = { buildGuid: string; contentHash: string };
type Options = {
    directory?: string;
    extractor?: string;
    config?: string;
    node?: string;
    solver?: string;
};
type Job = {
    status: 'queued' | 'building' | 'ready' | 'failed';
    message: string;
    output: string;
    collision: string;
    log?: string;
    child?: { kill: (signal?: NodeJS.Signals) => boolean };
    result?: unknown;
};
type RouteRequest = {
    point?: string | null;
    scene: string;
    source: Source;
    arrival: TravelArrival;
    target: Vec3;
    interaction?: InteractionGoal;
    walls: Wall[];
    waypoints?: Vec3[];
};
const hash = (value: unknown) =>
    createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const physicalTileSpan = 256 * 0.15;
export const physicalMargins = [24, 64, 128, 256] as const;

type Approach = { margin: number; corridor?: Corridor };

const coverage = (start: number[], target: number[], approach: Approach) => {
    const { margin, corridor } = approach;
    const min = corridor?.bounds.min ?? [
        Math.min(start[0], target[0]) - margin,
        Math.min(start[2], target[2]) - margin,
    ];
    const max = corridor?.bounds.max ?? [
        Math.max(start[0], target[0]) + margin,
        Math.max(start[2], target[2]) + margin,
    ];
    const bounds = [
        Math.floor(min[0] / 32) * 32,
        Math.floor(min[1] / 32) * 32,
        Math.ceil(max[0] / 32) * 32,
        Math.ceil(max[1] / 32) * 32,
    ];
    const tiles =
        corridor?.tiles.length ??
        (Math.ceil(bounds[2] / physicalTileSpan) -
            Math.floor(bounds[0] / physicalTileSpan)) *
            (Math.ceil(bounds[3] / physicalTileSpan) -
                Math.floor(bounds[1] / physicalTileSpan));
    return { bounds, tiles };
};

/** Rank both coverage proposals by the same tile estimate used by the builder.
 * A failed attempt advances to another proposal without classifying the route
 * by endpoint distance or elevation. All original widening choices remain.
 */
export const physicalApproaches = (
    start: number[],
    target: number[],
    corridors: Corridor[],
): Approach[] =>
    [
        ...physicalMargins.map((margin) => ({ margin })),
        ...corridors.map((corridor, index) => ({
            margin: physicalMargins[
                Math.min(index, physicalMargins.length - 1)
            ],
            corridor,
        })),
    ].sort(
        (a, b) =>
            coverage(start, target, a).tiles - coverage(start, target, b).tiles,
    );

/** Ground construction and known-action queries share a foreground lane.
 * Queries over ready ground precede further queued builds. Jump optimization
 * uses an independent lane, so it cannot hold up a device feasibility result.
 */
export function physicalRouteBuilder(options: Options) {
    const jobs = new Map<string, Job>();
    let retainedGround: Job | undefined;
    const groundLoads = new WeakMap<Job, Promise<unknown>>();
    const retainGround = (job: Job, result: unknown) => {
        // Ground artifacts already live on disk. Polling reuses the current
        // region; visiting another region releases the previous decoded mesh.
        if (retainedGround && retainedGround !== job)
            delete retainedGround.result;
        retainedGround = job;
        job.result = result;
    };
    const workerOptions = {
        extractor: options.extractor ?? '',
        node: options.node || process.execPath,
    };
    const solverWorkers = [
        createRouteWorker(workerOptions),
        createRouteWorker(workerOptions),
    ];
    const busyWorkers = new Set<(typeof solverWorkers)[number]>();
    const workerRegions = new Map<(typeof solverWorkers)[number], string>();
    const workerUses = new Map<(typeof solverWorkers)[number], number>();
    let workerUse = 0;
    const startSolver = async (args: string[]) => {
        const region = hash(
            ['--ground', '--collision', '--movement-settings'].map(
                (flag) => args[args.indexOf(flag) + 1],
            ),
        );
        // A completed foreground device check can hand its prepared region to
        // optimization; the other worker remains available for foreground work.
        const worker =
            solverWorkers.find(
                (entry) =>
                    !busyWorkers.has(entry) &&
                    workerRegions.get(entry) === region,
            ) ??
            solverWorkers
                .filter((entry) => !busyWorkers.has(entry))
                .sort(
                    (a, b) =>
                        (workerUses.get(a) ?? 0) - (workerUses.get(b) ?? 0),
                )[0];
        if (!worker) throw new Error('Both route solver lanes are occupied');
        // A different region cannot reuse preparation. Release its whole heap
        // rather than making old large graphs survive into another decoding pass.
        if (workerRegions.get(worker) !== region) worker.discard();
        busyWorkers.add(worker);
        try {
            const task = await worker.start(args);
            workerRegions.set(worker, region);
            workerUses.set(worker, ++workerUse);
            task.once('close', () => busyWorkers.delete(worker));
            return task;
        } catch (error) {
            busyWorkers.delete(worker);
            throw error;
        }
    };
    const foreground: { run: () => Promise<void>; query: boolean }[] = [];
    let foregroundRunning = false;
    let foregroundTask: Promise<void> | undefined;
    const drain = () => {
        if (foregroundRunning || !foreground.length) return;
        const query = foreground.findIndex((entry) => entry.query);
        const [next] = foreground.splice(query < 0 ? 0 : query, 1);
        foregroundRunning = true;
        foregroundTask = next.run().finally(() => {
            foregroundRunning = false;
            drain();
        });
    };
    let optimization = Promise.resolve();
    let closed = false;
    const configured = Boolean(
        options.directory && options.extractor && options.config,
    );
    let movement: Promise<{ fingerprint: string; path: string }> | undefined;
    let generator: Promise<string> | undefined;
    const generatorIdentity = () => {
        generator ??= promisify(execFile)(
            options.node || process.execPath,
            [
                resolve(options.extractor!, 'packages/extractor/src/cli.ts'),
                'player-ground',
                '--identity',
            ],
            { cwd: options.extractor },
        )
            .then(({ stdout }) => {
                const result = JSON.parse(stdout);
                if (typeof result.generator !== 'string' || !result.generator)
                    throw new Error(
                        'Missing physical ground generator identity',
                    );
                return result.generator;
            })
            .catch((error) => {
                generator = undefined;
                throw error;
            });
        return generator;
    };
    const movementFile = () => {
        movement ??= (async () => {
            const bytes = await readFile(
                resolve(options.directory!, 'movement-settings-current.json'),
            );
            const fingerprint = createHash('sha256')
                .update(bytes)
                .digest('hex');
            const directory = resolve(options.directory!, 'movement');
            await mkdir(directory, { recursive: true });
            const path = resolve(directory, `${fingerprint}.json`);
            const temporary = `${path}.${randomUUID()}.tmp`;
            // Both child stages consume the same immutable content used by their cache keys.
            try {
                await writeFile(temporary, bytes);
                await rename(temporary, path);
            } finally {
                await unlink(temporary).catch(() => {});
            }
            return { fingerprint, path };
        })().catch((error) => {
            movement = undefined;
            throw error;
        });
        return movement;
    };
    const cacheLog = async (job: Job, context: Record<string, unknown>) => {
        job.log = `${job.output}.progress.jsonl`;
        const entry = {
            time: new Date().toISOString(),
            run: randomUUID(),
            event: 'cache-hit',
            ...context,
            log: relative(options.directory!, job.log),
            output: relative(options.directory!, job.output),
        };
        await Promise.all([
            appendFile(job.log, JSON.stringify(entry) + '\n'),
            appendFile(
                resolve(options.directory!, 'route-jobs.jsonl'),
                JSON.stringify(entry) + '\n',
            ),
        ]).catch((failure) =>
            console.error('Unable to retain cached route log', failure),
        );
    };
    const enqueue = (
        current: Job,
        args: string[],
        {
            background,
            context,
        }: { background: boolean; context: Record<string, unknown> },
    ): void => {
        const runId = randomUUID();
        const queuedAt = performance.now();
        const log = `${current.output}.progress.jsonl`;
        current.log = log;
        let writes = Promise.resolve();
        const record = (
            event: string,
            detail: Record<string, unknown> = {},
        ) => {
            const line =
                JSON.stringify({
                    ...detail,
                    time: new Date().toISOString(),
                    run: runId,
                    elapsedMs: Math.round(performance.now() - queuedAt),
                    event,
                }) + '\n';
            writes = writes
                .then(() => appendFile(log, line))
                .catch((failure) => {
                    console.error('Unable to save route progress', failure);
                });
        };
        record('queued', { ...context, command: args, output: current.output });
        writes = writes
            .then(() =>
                appendFile(
                    resolve(options.directory!, 'route-jobs.jsonl'),
                    JSON.stringify({
                        time: new Date().toISOString(),
                        run: runId,
                        ...context,
                        log: relative(options.directory!, log),
                        output: relative(options.directory!, current.output),
                    }) + '\n',
                ),
            )
            .catch((failure) =>
                console.error('Unable to index route progress', failure),
            );
        const run = async () => {
            await writes;
            await new Promise<void>((done) => {
                if (closed) {
                    current.status = 'failed';
                    current.message = 'Route server restarted';
                    done();
                    return;
                }
                current.status = 'building';
                record('started');
                const launch = async () => {
                    const child =
                        args[0] === 'player-route'
                            ? await startSolver(args)
                            : spawn(
                                  options.node || process.execPath,
                                  [
                                      resolve(
                                          options.extractor!,
                                          'packages/extractor/src/cli.ts',
                                      ),
                                      ...args,
                                  ],
                                  {
                                      cwd: options.extractor,
                                      stdio: ['ignore', 'pipe', 'pipe'],
                                  },
                              );
                    current.child = child;
                    record('solver-started', {
                        pid: child.pid,
                        reusedProcess: 'reused' in child && child.reused,
                    });
                    let error = '',
                        pending = '';
                    child.stderr?.on('data', (bytes) => {
                        record('stderr', { text: String(bytes) });
                        error = (error + String(bytes)).slice(-12000);
                    });
                    child.stdout?.on('data', (bytes) => {
                        pending += String(bytes);
                        const lines = pending.split('\n');
                        pending = lines.pop() || '';
                        for (const line of lines) {
                            try {
                                const progress = JSON.parse(line);
                                record('progress', {
                                    ...progress,
                                    durationMs: progress.elapsedMs,
                                });
                                if (progress.phase === 'collision-inputs')
                                    current.message =
                                        'Reading collision sources…';
                                if (progress.phase === 'ground-tile')
                                    current.message = `${progress.cached ? 'Reusing' : 'Preparing'} route terrain (${progress.completed}/${progress.total})`;
                                if (progress.phase === 'ground')
                                    current.message = 'Physical ground ready';
                                if (progress.phase === 'ground-search')
                                    current.message =
                                        'Searching connected terrain…';
                                if (progress.phase === 'device-links')
                                    current.message =
                                        'Checking ropes and launch devices…';
                                if (progress.phase === 'goal-refinement')
                                    current.message = 'Refining target access…';
                                if (progress.phase === 'direction-search')
                                    current.message = `Exploring route regions (${progress.completed}/${progress.total})`;
                                if (progress.phase === 'device-entry-search')
                                    current.message = `Finding device approaches (${progress.completed}/${progress.total})`;
                                if (progress.phase === 'ground-route') {
                                    current.message =
                                        'Walking route ready. Comparing alternatives…';
                                    void readFile(current.output, 'utf8')
                                        .then((bytes) => {
                                            const result = JSON.parse(bytes);
                                            if (
                                                current.status === 'building' &&
                                                result.status === 'candidate'
                                            )
                                                current.result = result;
                                        })
                                        .catch(() => {});
                                }
                                if (progress.phase === 'collision-index')
                                    current.message =
                                        'Indexing physical obstacles…';
                                if (progress.phase === 'jump-discovery')
                                    current.message =
                                        'Comparing ground, device, jump and drop actions…';
                                if (progress.phase === 'route-search')
                                    current.message =
                                        'Planning movement and sprint recovery…';
                            } catch {
                                record('stdout', { text: line });
                            }
                        }
                    });
                    child.once('error', (failure) => {
                        current.status = 'failed';
                        current.message = failure.message;
                        record('process-error', { message: failure.message });
                    });
                    child.once('close', (code, signal) => {
                        record(
                            'reused' in child
                                ? 'solver-finished'
                                : 'process-exit',
                            { code, signal },
                        );
                        if (pending) record('stdout', { text: pending });
                        void (async () => {
                            delete current.child;
                            if (code === 0) {
                                const result = JSON.parse(
                                    await readFile(current.output, 'utf8'),
                                );
                                if (args[0] === 'player-ground')
                                    retainGround(current, result);
                                else current.result = result;
                                current.status = 'ready';
                                current.message = 'Physical route data ready';
                            } else {
                                current.status = 'failed';
                                const detail = error
                                    .split('\n')
                                    .find((line) =>
                                        /^(?:[A-Za-z]*Error|FATAL ERROR):/.test(
                                            line,
                                        ),
                                    );
                                current.message =
                                    /heap out of memory|reached heap limit/i.test(
                                        error,
                                    )
                                        ? 'Route calculation exceeded its memory limit'
                                        : detail ||
                                          (signal
                                              ? `Physical route job terminated (${signal})`
                                              : `Physical route job exited (${code})`);
                                await writeFile(
                                    `${current.output}.error.log`,
                                    error || current.message,
                                ).catch(() => {});
                                if (!current.result)
                                    await unlink(current.output).catch(
                                        () => {},
                                    );
                            }
                        })()
                            .catch((failure) => {
                                current.status = 'failed';
                                current.message = String(failure);
                            })
                            .finally(done);
                    });
                };
                void launch().catch((failure) => {
                    current.status = 'failed';
                    current.message = String(failure);
                    done();
                });
            }).catch((failure) => {
                current.status = 'failed';
                current.message = String(failure);
            });
            record('finished', {
                status: current.status,
                message: current.message,
                serverMemory: process.memoryUsage(),
            });
            await writes;
        };
        if (background) optimization = optimization.then(run);
        else {
            foreground.push({ run, query: args[0] === 'player-route' });
            drain();
        }
    };
    const query = async (
        scene: string,
        source: Source,
        start: number[],
        target: number[],
        request: { startBuild: boolean; margin?: number; corridor?: Corridor },
    ) => {
        if (!configured || closed) return null;
        const margin = request.margin ?? physicalMargins[0];
        if (!Number.isFinite(margin) || margin < 0)
            throw new Error('Invalid physical coverage margin');
        const corridor = request.corridor;
        const { bounds, tiles } = coverage(start, target, { margin, corridor });
        if (!bounds.every(Number.isSafeInteger) || tiles > 512) {
            return {
                status: 'failed' as const,
                message:
                    'Route region exceeds the current physical build budget',
                output: '',
                collision: '',
            };
        }
        const settings = await movementFile();
        const buildIdentity = await generatorIdentity();
        const key = hash({
            scene,
            source,
            bounds,
            state: 0,
            area: 0,
            policy: 4,
            tiles: corridor?.tiles,
            movement: settings.fingerprint,
            generator: buildIdentity,
        });
        let job = jobs.get(key);
        if (!job) {
            if (!request.startBuild) return null;
            const directory = resolve(options.directory!, 'player-ground');
            await mkdir(directory, { recursive: true });
            const output = resolve(directory, `${scene}-${key}.json`);
            const collision = resolve(
                directory,
                `${scene}-${key}-collision.json`,
            );
            job = {
                status: 'queued',
                message: 'Queued physical ground build…',
                output,
                collision,
            };
            // Re-check after async directory preparation so concurrent requests share one job.
            const existing = jobs.get(key);
            if (existing) return existing;
            jobs.set(key, job);
            try {
                const result = JSON.parse(await readFile(output, 'utf8'));
                if (
                    result.source?.buildGuid === source.buildGuid &&
                    result.source?.contentHash === source.contentHash &&
                    Array.isArray(result.surfaces)
                ) {
                    await cacheLog(job, {
                        stage: 'ground',
                        scene,
                        source,
                        bounds,
                    });
                    job.status = 'ready';
                    retainGround(job, result);
                    job.message = 'Physical ground ready';
                    return { ...job, result };
                }
            } catch {
                /* No completed cache is available yet. */
            }
            enqueue(
                job,
                [
                    'player-ground',
                    scene,
                    `--bounds=${bounds.join(',')}`,
                    '--scene-state',
                    '0',
                    '--area',
                    '0',
                    '--movement-settings',
                    settings.path,
                    '-o',
                    output,
                    '--collision-output',
                    collision,
                    '--input-cache',
                    resolve(options.directory!, 'collision-cache'),
                    '--tile-cache',
                    resolve(options.directory!, 'ground-tile-cache'),
                    '--config',
                    options.config!,
                    ...(corridor
                        ? [
                              '--tiles=' +
                                  corridor.tiles
                                      .map((tile) => `${tile.x},${tile.z}`)
                                      .join(';'),
                          ]
                        : []),
                ],
                {
                    background: false,
                    context: {
                        stage: 'ground',
                        scene,
                        source,
                        bounds,
                        coarse: corridor?.coarse,
                        tiles: corridor?.tiles,
                    },
                },
            );
        }
        if (job.status === 'ready' && !job.result) {
            let pending = groundLoads.get(job);
            if (!pending) {
                const current = job;
                pending = readFile(current.output, 'utf8')
                    .then((bytes) => {
                        const result = JSON.parse(bytes);
                        if (
                            result.source?.buildGuid !== source.buildGuid ||
                            result.source?.contentHash !== source.contentHash ||
                            !Array.isArray(result.surfaces)
                        )
                            throw new Error('Invalid retained physical ground');
                        retainGround(current, result);
                        return result;
                    })
                    .finally(() => groundLoads.delete(current));
                groundLoads.set(current, pending);
            }
            // Keep this response's mesh alive even if a concurrent request
            // switches the retained region before this continuation resumes.
            return { ...job, result: await pending };
        }
        return job.status === 'ready' ? { ...job } : job;
    };
    const deviceInputs = new Map<
        string,
        Promise<{ path: string; fingerprint: string } | undefined>
    >();
    const deviceFile = (scene: string) => {
        let pending = deviceInputs.get(scene);
        if (!pending) {
            pending = (async () => {
                const source = resolve(
                    options.directory!,
                    `${scene}-traversal-devices.json`,
                );
                let bytes;
                try {
                    bytes = await readFile(source);
                } catch (error) {
                    if (
                        error instanceof Error &&
                        'code' in error &&
                        error.code === 'ENOENT'
                    )
                        return undefined;
                    throw error;
                }
                const fingerprint = createHash('sha256')
                    .update(bytes)
                    .digest('hex');
                const directory = resolve(options.directory!, 'devices');
                await mkdir(directory, { recursive: true });
                const path = resolve(directory, `${fingerprint}.json`);
                const temporary = `${path}.${randomUUID()}.tmp`;
                try {
                    await writeFile(temporary, bytes);
                    await rename(temporary, path);
                } finally {
                    await unlink(temporary).catch(() => {});
                }
                return { path, fingerprint };
            })().catch((error) => {
                deviceInputs.delete(scene);
                throw error;
            });
            deviceInputs.set(scene, pending);
        }
        return pending;
    };
    const solve = async (
        ground: Job,
        request: RouteRequest,
        startSolve: boolean,
        stage: 'walking' | 'devices' | 'all' = 'all',
    ) => {
        if (!configured || closed || ground.status !== 'ready') return null;
        const settings = await movementFile();
        const devices =
            stage === 'walking' ? undefined : await deviceFile(request.scene);
        // Traversals depend on endpoints, interaction volumes and exclusions, even when ground tiles are shared.
        const key = hash({
            stage:
                stage === 'walking'
                    ? 'walking-route'
                    : stage === 'devices'
                      ? 'device-route'
                      : 'route',
            ground: ground.output,
            request,
            policy: stage === 'walking' ? 14 : 17,
            devices: devices?.fingerprint,
            movement: settings.fingerprint,
            solver: options.solver,
        });
        let job = jobs.get(key);
        if (job || !startSolve) return job ?? null;
        const directory = resolve(options.directory!, 'player-routes');
        await mkdir(directory, { recursive: true });
        const existing = jobs.get(key);
        if (existing) return existing;
        const output = resolve(directory, `${request.scene}-${key}.json`);
        const input = resolve(
            directory,
            `${request.scene}-${key}-request.json`,
        );
        job = {
            status: 'queued',
            message: 'Queued physical route search…',
            output,
            collision: ground.collision,
        };
        jobs.set(key, job);
        try {
            const result = JSON.parse(await readFile(output, 'utf8'));
            if (
                result.scene === request.scene &&
                result.source?.buildGuid === request.source.buildGuid &&
                result.source?.contentHash === request.source.contentHash &&
                ['candidate', 'unavailable'].includes(result.status)
            ) {
                job.result = result;
                if (result.optimizing !== true) {
                    job.status = 'ready';
                    job.message = 'Physical route data ready';
                    await cacheLog(job, {
                        stage,
                        scene: request.scene,
                        point: request.point,
                        source: request.source,
                    });
                    return job;
                }
            }
        } catch {
            /* Rebuild missing or incomplete query artifacts. */
        }
        const temporary = `${input}.${process.pid}.tmp`;
        try {
            await writeFile(temporary, JSON.stringify(request));
            await rename(temporary, input);
            const args = [
                'player-route',
                '--ground',
                ground.output,
                '--collision',
                ground.collision,
                '--movement-settings',
                settings.path,
                '--request',
                input,
                '-o',
                output,
                ...(devices ? ['--devices', devices.path] : []),
            ];
            enqueue(
                job,
                stage === 'all'
                    ? args
                    : [
                          ...args,
                          stage === 'walking'
                              ? '--ground-only'
                              : '--devices-only',
                      ],
                {
                    background: stage === 'all',
                    context: {
                        stage,
                        scene: request.scene,
                        point: request.point,
                        source: request.source,
                        from: request.arrival.position,
                        target: request.target,
                    },
                },
            );
        } catch (error) {
            job.status = 'failed';
            job.message = String(error);
            await unlink(temporary).catch(() => {});
        }
        return job;
    };
    return {
        query,
        solve,
        async close() {
            closed = true;
            for (const worker of solverWorkers) worker.close();
            for (const job of jobs.values()) job.child?.kill('SIGTERM');
            while (foregroundRunning) await foregroundTask;
            await optimization;
            jobs.clear();
            retainedGround = undefined;
        },
    };
}
