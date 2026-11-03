import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { GroundArrival, InteractionGoal, Vec3, Wall } from '@oem/ganglia';

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
    child?: ChildProcess;
    result?: unknown;
};
type RouteRequest = {
    scene: string;
    source: Source;
    arrival: GroundArrival;
    target: Vec3;
    interaction?: InteractionGoal;
    walls: Wall[];
};
const hash = (value: unknown) =>
    createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const physicalMargins = [24, 64, 128, 256] as const;

/** Bounded, cached physical builds for local inspection. One child owns native compilation at a time. */
export function physicalRouteBuilder(options: Options) {
    const jobs = new Map<string, Job>();
    let queue = Promise.resolve();
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
    const enqueue = (current: Job, args: string[]) => {
        queue = queue.then(
            () =>
                new Promise<void>((done) => {
                    if (closed) {
                        current.status = 'failed';
                        current.message = 'Route server restarted';
                        done();
                        return;
                    }
                    current.status = 'building';
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
                        error = (error + String(bytes)).slice(-12000);
                    });
                    child.stdout?.on('data', (bytes) => {
                        pending += String(bytes);
                        const lines = pending.split('\n');
                        pending = lines.pop() || '';
                        for (const line of lines) {
                            try {
                                const progress = JSON.parse(line);
                                if (progress.phase === 'collision-inputs')
                                    current.message = `Reading collision sources · ${JSON.stringify(progress.cell)}`;
                                if (progress.phase === 'ground')
                                    current.message = 'Physical ground ready';
                                if (progress.phase === 'collision-index')
                                    current.message =
                                        'Indexing physical obstacles…';
                                if (progress.phase === 'jump-discovery')
                                    current.message =
                                        'Comparing ground, jump and drop actions…';
                                if (progress.phase === 'route-search')
                                    current.message =
                                        'Planning movement and sprint recovery…';
                            } catch {
                                /* Other extractor diagnostics are not progress events. */
                            }
                        }
                    });
                    child.once('error', (failure) => {
                        current.status = 'failed';
                        current.message = failure.message;
                        delete current.child;
                        done();
                    });
                    child.once('exit', (code) => {
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
                                current.message =
                                    error
                                        .split('\n')
                                        .find((line) =>
                                            line.startsWith('Error:'),
                                        ) || 'Physical route job failed';
                                await unlink(current.output).catch(() => {});
                            }
                        })()
                            .catch((failure) => {
                                current.status = 'failed';
                                current.message = String(failure);
                            })
                            .finally(done);
                    });
                }),
        );
    };
    const query = async (
        scene: string,
        source: Source,
        start: number[],
        target: number[],
        request: { startBuild: boolean; margin?: number },
    ) => {
        if (!configured || closed) return null;
        const margin = request.margin ?? physicalMargins[0];
        if (!Number.isFinite(margin) || margin < 0)
            throw new Error('Invalid physical coverage margin');
        const bounds = [
            Math.floor((Math.min(start[0], target[0]) - margin) / 32) * 32,
            Math.floor((Math.min(start[2], target[2]) - margin) / 32) * 32,
            Math.ceil((Math.max(start[0], target[0]) + margin) / 32) * 32,
            Math.ceil((Math.max(start[2], target[2]) + margin) / 32) * 32,
        ];
        const tileSpan = 256 * 0.15;
        const tiles =
            (Math.ceil((bounds[2] - bounds[0]) / tileSpan) + 2) *
            (Math.ceil((bounds[3] - bounds[1]) / tileSpan) + 2);
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
            policy: 3,
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
                    return job;
                }
            } catch {
                /* No completed cache is available yet. */
            }
            enqueue(job, [
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
            ]);
        }
        return job;
    };
    const solve = async (
        ground: Job,
        request: RouteRequest,
        startSolve: boolean,
    ) => {
        if (!configured || closed || ground.status !== 'ready') return null;
        const settings = await movementFile();
        // Traversals depend on endpoints, interaction volumes and exclusions, even when ground tiles are shared.
        const key = hash({
            stage: 'route',
            ground: ground.output,
            request,
            policy: 3,
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
                job.status = 'ready';
                job.result = result;
                job.message = 'Physical route data ready';
                return job;
            }
        } catch {
            /* Rebuild missing or incomplete query artifacts. */
        }
        const temporary = `${input}.${process.pid}.tmp`;
        try {
            await writeFile(temporary, JSON.stringify(request));
            await rename(temporary, input);
            enqueue(job, [
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
            ]);
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
        close() {
            closed = true;
            for (const job of jobs.values()) job.child?.kill('SIGTERM');
            jobs.clear();
        },
    };
}
