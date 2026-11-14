import { transport } from './transport';
import type { Route, Vec3 } from '@opendfieldmap/ganglia';
export type SupportBox = {
    min: Vec3;
    max: Vec3;
    device: string;
    family: string;
    role: 'board' | 'leave' | 'use';
};
export type Candidate = {
    version: 1;
    scene: string;
    level: string;
    source: { buildGuid: string; contentHash: string };
    generation?: string;
    state?: 'fully-enabled';
    title: string;
    status: 'candidate';
    draft?: boolean;
    partial?: boolean;
    log?: string;
    coverage?: string;
    assumptions?: string[];
    overview?: { position: Vec3; yaw: number; pitch: number; fovY: number };
    route: Extract<Route, { status: 'complete' }>;
    supportBoxes?: SupportBox[];
    markers: { label: string; position: Vec3 }[];
};
export interface RouteRequest {
    generation: string;
    state: 'fully-enabled';
    scene: string;
    level: string;
    point: string;
    x: string;
    y: string;
    z: string;
    buildGuid: string;
    contentHash: string;
}
export type RouteUpdate = (
    | Candidate
    | { status: 'building-ground' | 'unavailable' | 'error'; log?: string }
) & { optimizing?: boolean; message?: string; optimizationMessage?: string };
const pause = (signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
        const stop = () => {
            clearTimeout(timer);
            reject(
                signal.reason instanceof Error
                    ? signal.reason
                    : new DOMException('Aborted', 'AbortError'),
            );
        };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', stop);
            resolve();
        }, 1000);
        signal.addEventListener('abort', stop, { once: true });
        if (signal.aborted) stop();
    });

export const routing = {
    async *nearest(
        request: RouteRequest,
        signal: AbortSignal,
    ): AsyncGenerator<RouteUpdate> {
        const query = new URLSearchParams({ ...request });
        for (;;) {
            signal.throwIfAborted();
            const response = await transport.fetch(
                'routing',
                `/__routes/nearest?${query}`,
                { signal },
            );
            const result = (await response.json()) as RouteUpdate;
            if (!response.ok)
                throw new Error(
                    result.message ?? `Routing: HTTP ${response.status}`,
                );
            if (
                result.status === 'candidate' &&
                (result.generation !== request.generation ||
                    result.state !== request.state)
            )
                throw new Error(
                    'Route result does not match the requested scene snapshot',
                );
            yield result;
            if (
                result.status !== 'building-ground' &&
                !(result.status === 'candidate' && result.optimizing)
            )
                return;
            await pause(signal);
        }
    },
    async preview(url: URL, signal: AbortSignal): Promise<Candidate> {
        if (
            url.origin !== location.origin ||
            !(
                url.pathname.startsWith('/oem/') ||
                url.pathname === '/__routes/preview'
            )
        )
            throw new Error('Route preview only reads local route data');
        const response = await transport.fetch('routing', url, { signal });
        if (!response.ok) throw new Error('Unable to load candidate route');
        return (await response.json()) as Candidate;
    },
};
