import type {PhysicalWork} from '@opendfieldmap/ganglia/solver/host';
import { readFile } from 'node:fs/promises';
import { createWindowRoute as createRoute, type WindowConfig } from '@opendfieldmap/ganglia/solver';
import type { GroundOptions, Surface, Route, Vec3 } from '@opendfieldmap/ganglia';
import { physicalTileSpan, type Job, type RouteRequest } from './physical-route-builder.ts';
import type { Corridor } from '@opendfieldmap/ganglia/solver';

type Builder = {
    query(scene: string, source: RouteRequest['source'], start: number[], target: number[], options: { startBuild: boolean; margin: number; corridor: Corridor }): Promise<Job | null>;
    solve(job: Job, request: RouteRequest, start: boolean, work: PhysicalWork): Promise<Job | null>;
};

export function createWindowRoute(builder: Builder, request: RouteRequest, points: Vec3[], config: Omit<WindowConfig, 'tileSpan' | 'gridSpan'>) {
    return createRoute({
        ...builder,
        key: ground => ground.output,
        ground: async ground => JSON.parse(await readFile(ground.output, 'utf8')) as { surfaces: Surface[]; options: GroundOptions },
        route: job => job.result as { route?: Route; reason?: string },
    }, request, points, { ...config, tileSpan: physicalTileSpan, gridSpan: 32 });
}
