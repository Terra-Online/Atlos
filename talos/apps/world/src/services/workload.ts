import { sceneReference } from './scene';
import type { Viewer } from '@endfield-noclip/viewer/host';
import type { Point } from '@endfield-noclip/package-format/oem';
import { sampleJourney, type Vec3 } from '@opendfieldmap/ganglia';
import { routing } from './routing';
import { transport } from './transport';

export interface Workload {
    version: 1;
    scene: string;
    points: [string, string];
    camera: { position: Vec3; yaw: number; pitch: number; ms: number }[];
    tailMs: number;
    timeoutMs: number;
}
const delay = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Development-only control of real UI operations; rendering and client reads
 * use the ordinary application paths. Workloads supply fixed camera poses. */
export function installWorkload(
    viewer: Viewer,
    {
        select,
        current,
        pending,
        failure,
        release,
    }: {
        select: (id: string) => void;
        current: () => Point | null;
        pending: () => boolean;
        failure: () => string | null;
        release: () => string | undefined;
    },
) {
    const initial = performance.now();
    transport.operation('open-scene');
    const ready = async (id?: string) => {
        const started = performance.now();
        while (
            pending() ||
            !current() ||
            (id && current()?.id !== id) ||
            viewer.controls.flying
        ) {
            if (failure()) throw new Error(failure() ?? 'Scene failed');
            if (performance.now() - started > 180_000)
                throw new Error('Scene did not become ready');
            await delay(50);
        }
    };
    const camera = async (pose: Workload['camera'][number]) => {
        viewer.controls.cancelFlight();
        const from = [...viewer.camera.position];
        const yaw = viewer.camera.yaw,
            pitch = viewer.camera.pitch;
        const started = performance.now();
        await new Promise<void>((resolve) => {
            const frame = (now: number) => {
                const t = Math.min(1, (now - started) / pose.ms);
                viewer.camera.position = [
                    from[0] + (pose.position[0] - from[0]) * t,
                    from[1] + (pose.position[1] - from[1]) * t,
                    from[2] + (pose.position[2] - from[2]) * t,
                ];
                viewer.camera.yaw = yaw + (pose.yaw - yaw) * t;
                viewer.camera.pitch = pitch + (pose.pitch - pitch) * t;
                viewer.setOptions({});
                if (t < 1) requestAnimationFrame(frame);
                else resolve();
            };
            requestAnimationFrame(frame);
        });
    };
    const api = {
        async ready() {
            await ready();
            return {
                release: release(),
                point: current(),
                source: viewer.scene?.pkg.manifest.source,
                generation: viewer.scene?.pkg.manifest.generation,
                options: { ...viewer.options },
            };
        },
        snapshot: () => transport.snapshot(),
        async run(workload: Workload) {
            if (
                workload.version !== 1 ||
                workload.scene !== current()?.scene ||
                workload.points[0] !== current()?.id
            )
                throw new Error(
                    'Workload does not match the opened scene and target',
                );
            const operations: {
                name: string;
                started: number;
                durationMs: number;
                firstCandidateMs?: number;
            }[] = [
                {
                    name: 'open-scene',
                    started: initial,
                    durationMs: performance.now() - initial,
                },
            ];
            const operation = async (
                name: string,
                run: () => Promise<void>,
            ) => {
                transport.operation(name);
                const started = performance.now();
                await run();
                await delay(workload.tailMs);
                operations.push({
                    name,
                    started,
                    durationMs: performance.now() - started,
                });
            };
            let route: Awaited<ReturnType<typeof routing.preview>> | undefined;
            const query = async () => {
                const point = current(),
                    source = viewer.scene?.pkg.manifest.source;
                if (!point || !source) throw new Error('Scene is not ready');
                const abort = new AbortController();
                const timeout = setTimeout(
                    () => abort.abort(new Error('Route workload timed out')),
                    workload.timeoutMs,
                );
                const started = performance.now();
                let firstCandidateMs: number | undefined;
                try {
                    let last;
                    for await (const result of routing.nearest(
                        {
                            ...sceneReference(viewer),
                            scene: point.scene,
                            level: point.level,
                            point: point.id,
                            x: String(point.position[0]),
                            y: String(point.position[1]),
                            z: String(point.position[2]),
                            ...source,
                        },
                        abort.signal,
                    )) {
                        last = result;
                        if (result.status === 'candidate') {
                            firstCandidateMs ??= performance.now() - started;
                            route = result;
                        }
                    }
                    if (
                        last?.status !== 'candidate' ||
                        last.partial ||
                        !route ||
                        route.route.status !== 'complete'
                    )
                        throw new Error(
                            'Route workload did not produce a complete route',
                        );
                    window.dispatchEvent(
                        new CustomEvent('world:benchmark-route', {
                            detail: route,
                        }),
                    );
                    return firstCandidateMs;
                } finally {
                    clearTimeout(timeout);
                }
            };
            await operation('browse-scene', async () => {
                for (const pose of workload.camera) await camera(pose);
            });
            await operation('switch-target', async () => {
                for (const id of [workload.points[1], workload.points[0]]) {
                    select(id);
                    await ready(id);
                }
            });
            let firstCandidateMs: number | undefined;
            await operation('query-route', async () => {
                firstCandidateMs = await query();
            });
            operations[operations.length - 1].firstCandidateMs =
                firstCandidateMs;
            await operation('show-route', async () => {
                if (!route) throw new Error('Missing route');
                for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
                    const p = sampleJourney(
                        route.route,
                        route.route.cost * fraction,
                    ).position;
                    await camera({
                        position: [p[0] + 6, p[1] + 8, p[2] - 10],
                        yaw: -0.54,
                        pitch: -0.6,
                        ms: 500,
                    });
                }
            });
            await operation('repeat-query', async () => {
                await query();
            });
            transport.operation('background');
            if (
                viewer.scene?.stream.stats.failed ||
                viewer.scene?.stream.stats.packageChanged
            )
                throw new Error('Scene streaming failed');
            return {
                timeOrigin: performance.timeOrigin,
                stream: viewer.scene?.stream.stats,
                operations,
                scene: viewer.scene?.pkg.manifest.scene.id,
                source: viewer.scene?.pkg.manifest.source,
                generation: viewer.scene?.pkg.manifest.generation,
                point: current()?.id,
                camera: {
                    position: Array.from(viewer.camera.position),
                    yaw: viewer.camera.yaw,
                    pitch: viewer.camera.pitch,
                },
                options: { ...viewer.options },
                route: route
                    ? {
                          status: route.route.status,
                          cost: route.route.cost,
                          points: route.route.points,
                      }
                    : null,
                ...transport.snapshot(),
            };
        },
    };
    window.__worldBenchmark = api;
    return () => {
        if (window.__worldBenchmark === api) delete window.__worldBenchmark;
    };
}
declare global {
    interface Window {
        __worldBenchmark?: {
            ready: () => Promise<unknown>;
            snapshot: () => ReturnType<typeof transport.snapshot>;
            run: (workload: Workload) => Promise<unknown>;
        };
    }
}
