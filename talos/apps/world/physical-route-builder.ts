import { spawn, type ChildProcess } from 'node:child_process';
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
import type { GroundArrival, InteractionGoal, Vec3, Wall } from '@oem/ganglia';
import type { Corridor } from './coarse-route.ts';

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
    child?: ChildProcess;
    result?: unknown;
};
type RouteRequest = {
    point?: string | null;
    scene: string;
    source: Source;
    arrival: GroundArrival;
    target: Vec3;
    interaction?: InteractionGoal;
    walls: Wall[];
};
const hash = (value: unknown) =>
    createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const physicalTileSpan = 256 * 0.15;
export const physicalMargins = [24, 64, 128, 256] as const;

/** Ground construction and known-action queries share a foreground lane.
 * Queries over ready ground precede further queued builds. Jump optimization
 * uses an independent lane, so it cannot hold up a device feasibility result.
 */
export function physicalRouteBuilder(options: Options) {
    const jobs = new Map<string, Job>();
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
                    time: new Date().toISOString(),
                    run: runId,
                    elapsedMs: Math.round(performance.now() - queuedAt),
                    event,
                    ...detail,
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
                const child = spawn(
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
                            record('progress', progress);
                            if (progress.phase === 'collision-inputs')
                                current.message = 'Reading collision sources…';
                            if (progress.phase === 'ground-tile')
                                current.message = `Preparing route terrain (${progress.completed}/${progress.total})`;
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
                    record('process-exit', { code, signal });
                    if (pending) record('stdout', { text: pending });
                    void (async () => {
                        delete current.child;
                        if (code === 0) {
                            current.result = JSON.parse(
                                await readFile(current.output, 'utf8'),
                            );
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
                                await unlink(current.output).catch(() => {});
                        }
                    })()
                        .catch((failure) => {
                            current.status = 'failed';
                            current.message = String(failure);
                        })
                        .finally(done);
                });
            }).catch((failure) => {
                current.status = 'failed';
                current.message = String(failure);
            });
            record('finished', {
                status: current.status,
                message: current.message,
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
        const bounds = corridor
            ? [
                  Math.floor(corridor.bounds.min[0] / 32) * 32,
                  Math.floor(corridor.bounds.min[1] / 32) * 32,
                  Math.ceil(corridor.bounds.max[0] / 32) * 32,
                  Math.ceil(corridor.bounds.max[1] / 32) * 32,
              ]
            : [
                  Math.floor((Math.min(start[0], target[0]) - margin) / 32) *
                      32,
                  Math.floor((Math.min(start[2], target[2]) - margin) / 32) *
                      32,
                  Math.ceil((Math.max(start[0], target[0]) + margin) / 32) * 32,
                  Math.ceil((Math.max(start[2], target[2]) + margin) / 32) * 32,
              ];
        const tiles =
            corridor?.tiles.length ??
            (Math.ceil((bounds[2] - bounds[0]) / physicalTileSpan) + 2) *
                (Math.ceil((bounds[3] - bounds[1]) / physicalTileSpan) + 2);
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
        const key = hash({
            scene,
            source,
            bounds,
            state: 0,
            area: 0,
            policy: 4,
            tiles: corridor?.tiles,
            movement: settings.fingerprint,
            solver: options.solver,
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
                    job.status = 'ready';
                    job.result = result;
                    job.message = 'Physical ground ready';
                    await cacheLog(job, {
                        stage: 'ground',
                        scene,
                        source,
                        bounds,
                    });
                    return job;
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
                    '--config',
                    options.config!,
                    ...(corridor
                        ? [
                              '--tiles',
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
        return job;
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
            policy: 10,
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
            for (const job of jobs.values()) job.child?.kill('SIGTERM');
            while (foregroundRunning) await foregroundTask;
            await optimization;
            jobs.clear();
        },
    };
}
