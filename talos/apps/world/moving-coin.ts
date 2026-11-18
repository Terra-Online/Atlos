import { readFile } from 'node:fs/promises';
import type {
    GroundOptions,
    InteractionGoal,
    LocomotionOptions,
    Route,
    Surface,
    Vec3,
} from '@opendfieldmap/ganglia';
import { createPhysicalWorld } from '@opendfieldmap/ganglia/evaluation';
import {
    createCollisionWorld,
    createGoalProjector,
    findGoalHit,
} from '@opendfieldmap/ganglia/model';
import { gangliaV1Defaults } from '@opendfieldmap/ganglia/solver';
import {
    createGroundPlanner,
    createWindowRoute,
} from '@opendfieldmap/ganglia/solver/host';
import { setTimeout as delay } from 'node:timers/promises';
import type { Job, physicalRouteBuilder } from './physical-route-builder.ts';
import type { MovingContact } from './src/moving-contact.ts';
import type { TravelArrival } from './travel-arrivals.ts';

type Source = MovingContact['source'];
type Curve = MovingContact['trajectory']['segments'][number]['curve'];
type Segment = MovingContact['trajectory']['segments'][number] & {
    requiresNearby: boolean;
    smoothSpeed: boolean;
};
type Goal = { position: Vec3; interaction: InteractionGoal };
type Loop = {
    source: Source;
    splineId: number;
    startPosition: Vec3;
    repeatFrom: number;
    segments: Segment[];
};
type Guide = {
    anchor: TravelArrival;
    target: Vec3;
    points: Vec3[];
    score: number;
};
const distance = (a: Vec3, b: Vec3) =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const vector = (value: unknown): value is Vec3 =>
    Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
];
const sample = (curve: Curve, t: number, offset: Vec3): Vec3 => {
    const [a, b, c, d] = curve;
    const left = mix(mix(a, b, t), mix(b, c, t), t);
    const right = mix(mix(b, c, t), mix(c, d, t), t);
    const point = mix(left, right, t);
    return [point[0] + offset[0], point[1] + offset[1], point[2] + offset[2]];
};

/** Only uninterrupted, continuous loops with a source-confirmed activation event
 * admit a phase-independent terminal wait. A gated or timed coin requires a
 * route to its activation state and cannot use this proof.
 */
export function readCoinLoop(
    value: unknown,
    source: Omit<Source, 'path'>,
    placed: Vec3,
): Loop | null {
    if (!value || typeof value !== 'object') return null;
    const input = value as Partial<Loop> & {
        model?: string;
        activation?: string;
        placedPosition?: Vec3;
        camouflaged?: boolean;
        timeLimited?: boolean;
    };
    if (
        input.model !== 'source-coin-spline-v1' ||
        input.activation !== 'loaded-entity-tick' ||
        input.camouflaged !== false ||
        input.timeLimited !== false ||
        typeof input.source?.path !== 'string' ||
        !input.source.path ||
        input.source.buildGuid !== source.buildGuid ||
        input.source.contentHash !== source.contentHash ||
        !vector(input.placedPosition) ||
        distance(input.placedPosition, placed) > 1e-3 ||
        !vector(input.startPosition) ||
        !Number.isSafeInteger(input.splineId) ||
        !Number.isSafeInteger(input.repeatFrom) ||
        input.repeatFrom! < 0 ||
        !Array.isArray(input.segments) ||
        input.segments.length > 128 ||
        input.repeatFrom! >= input.segments.length
    )
        return null;
    const segments = input.segments;
    if (
        segments.some(
            (segment) =>
                !Array.isArray(segment?.curve) ||
                segment.curve.length !== 4 ||
                !segment.curve.every(vector) ||
                !Number.isFinite(segment.speed) ||
                segment.speed <= 0 ||
                !Number.isFinite(segment.waitSeconds) ||
                segment.waitSeconds < 0 ||
                segment.requiresNearby !== false ||
                segment.smoothSpeed !== false,
        ) ||
        distance(segments[0].curve[0], input.startPosition) > 1e-6 ||
        segments.some(
            (segment, index) =>
                index > 0 &&
                distance(segments[index - 1].curve[3], segment.curve[0]) > 1e-6,
        ) ||
        distance(
            segments.at(-1)!.curve[3],
            segments[input.repeatFrom!].curve[0],
        ) > 1e-6
    )
        return null;
    return {
        source: input.source,
        splineId: input.splineId!,
        repeatFrom: input.repeatFrom!,
        startPosition: input.startPosition,
        segments,
    };
}

function waitBound(loop: Loop): number {
    // A cubic's length never exceeds the length of its control polygon.
    return loop.segments.reduce(
        (total, { curve, speed, waitSeconds }) =>
            total +
            waitSeconds +
            (distance(curve[0], curve[1]) +
                distance(curve[1], curve[2]) +
                distance(curve[2], curve[3])) /
                speed,
        0,
    );
}

function contacts(
    loop: Loop,
    offset: Vec3,
    goal: Goal,
    coarse: { surfaces: Surface[]; options: GroundOptions },
    candidates: TravelArrival[],
): Guide[] {
    const inner = { radius: goal.interaction.radius - 0.22 };
    const hull = loop.segments.flatMap(({ curve }) => curve);
    const margin = 80;
    const lowX = Math.min(...hull.map((p) => p[0])) - margin;
    const highX = Math.max(...hull.map((p) => p[0])) + margin;
    const lowZ = Math.min(...hull.map((p) => p[2])) - margin;
    const highZ = Math.max(...hull.map((p) => p[2])) + margin;
    const starts = candidates
        .filter(
            (anchor) =>
                anchor.state === 'available' &&
                !anchor.groundRange &&
                anchor.position[0] >= lowX &&
                anchor.position[0] <= highX &&
                anchor.position[2] >= lowZ &&
                anchor.position[2] <= highZ,
        )
        .slice(0, 6);
    if (!starts.length) return [];
    const surfaces = coarse.surfaces.filter(({ vertices }) =>
        vertices.some(
            (p) =>
                p[0] >= lowX && p[0] <= highX && p[2] >= lowZ && p[2] <= highZ,
        ),
    );
    const ids = new Set(surfaces.map(({ id }) => id));
    const options = {
        ...coarse.options,
        portals: coarse.options.portals?.filter(
            ({ from, to }) => ids.has(from) && ids.has(to),
        ),
    };
    const project = createGoalProjector(surfaces);
    const planner = createGroundPlanner(surfaces, options);
    const found = new Map<
        string,
        { center: Vec3; foot: Vec3; score: number }
    >();
    for (const { curve } of loop.segments.slice(loop.repeatFrom)) {
        for (let step = 0; step < 24; step++) {
            const center = sample(curve, step / 24, offset);
            const hit = project.closest(center, { interaction: inner });
            if (!hit) continue;
            const floorDistance = hit.distance;
            const travelDistance = Math.min(
                ...starts.map(({ position }) =>
                    distance(position, hit.position),
                ),
            );
            const score = travelDistance + floorDistance * 5;
            const key = hit.position.map(Math.round).join('/');
            const previous = found.get(key);
            if (!previous || previous.score > score)
                found.set(key, { center, foot: hit.position, score });
        }
    }
    return [...found.values()]
        .sort((a, b) => a.score - b.score)
        .slice(0, 8)
        .map(({ center, foot, score }) => {
            const route = planner.plan(starts, center, { interaction: inner });
            const anchor =
                route.status === 'complete'
                    ? starts.find(({ id }) => route.start === id)!
                    : starts.reduce((best, next) =>
                          distance(next.position, foot) <
                          distance(best.position, foot)
                              ? next
                              : best,
                      );
            return {
                anchor,
                target: center,
                points:
                    route.status === 'complete'
                        ? route.points
                        : [anchor.position, foot],
                score: score + (route.status === 'complete' ? 0 : 1000),
            };
        })
        .sort((a, b) => a.score - b.score);
}

export type MovingApproach = {
    route: Extract<Route, { status: 'complete' }>;
    anchor: TravelArrival;
    terminal: MovingContact;
};

export async function planMovingCoin({
    loop,
    placed,
    goal,
    scene,
    candidates,
    coarse,
    locomotion,
    builder,
    signal,
    onProgress,
}: {
    loop: Loop;
    placed: Vec3;
    goal: Goal;
    scene: string;
    candidates: TravelArrival[];
    coarse: { surfaces: Surface[]; options: GroundOptions };
    locomotion: LocomotionOptions;
    builder: ReturnType<typeof physicalRouteBuilder>;
    signal: AbortSignal;
    onProgress: () => void;
}): Promise<MovingApproach | null> {
    if (
        !(goal.interaction.radius > 0.22) ||
        goal.interaction.facing ||
        goal.interaction.maxVertical !== undefined
    )
        return null;
    const offset: Vec3 = [
        goal.position[0] - placed[0],
        goal.position[1] - placed[1],
        goal.position[2] - placed[2],
    ];
    const maximumSeconds = waitBound(loop);
    if (!Number.isFinite(maximumSeconds) || maximumSeconds <= 0) return null;
    for (const guide of contacts(loop, offset, goal, coarse, candidates)) {
        signal.throwIfAborted();
        const request = {
            scene,
            source: loop.source,
            arrival: guide.anchor,
            target: guide.target,
            interaction: { radius: goal.interaction.radius - 0.22 },
            walls: coarse.options.walls,
            solverConfig: gangliaV1Defaults,
        };
        let lastGround: Job | undefined;
        const window = createWindowRoute(
            {
                query: builder.query,
                physical: builder.physical,
                solve(ground, local, start, work) {
                    lastGround = ground;
                    return builder.solve(ground, local, start, work);
                },
                key: (job) => job.output,
                ground: async (job) =>
                    JSON.parse(await readFile(job.output, 'utf8')) as {
                        surfaces: Surface[];
                        options: GroundOptions;
                    },
                route: (job) =>
                    job.result as { route?: Route; reason?: string },
            },
            request,
            guide.points,
            { ...gangliaV1Defaults, locomotion },
        );
        let result = await window.advance({ signal });
        while (result.status === 'pending') {
            onProgress();
            await delay(125, undefined, { signal });
            result = await window.advance({ signal });
        }
        if (result.status !== 'complete' || !lastGround) continue;
        const { route } = result;
        const end = route.points.at(-1)!;
        const snapshot = await builder.physical(lastGround, request);
        const { coverage, input } = snapshot;
        if (coverage === 'complete') continue;
        const scope = {
            min: [
                Math.max(end[0] - 2, coverage.bounds.min[0]),
                Math.max(end[2] - 2, coverage.bounds.min[1]),
            ] as [number, number],
            max: [
                Math.min(end[0] + 2, coverage.bounds.max[0]),
                Math.min(end[2] + 2, coverage.bounds.max[1]),
            ] as [number, number],
        };
        if (scope.min.some((value, axis) => value >= scope.max[axis])) continue;
        const geometry = input.collision;
        const world = createPhysicalWorld(
            input,
            { ...coverage, bounds: scope },
            {
                geometry,
                world: createCollisionWorld(geometry, { bounds: scope }),
            },
        );
        if (!world.covered(end, end)) continue;
        const prepared = world.configured(route.placements);
        const { profile } = input.ground.options;
        const ground = prepared.world.groundAt(end, {
            maxUp: 0.25,
            maxDown: 0.25,
            radius: profile.radius,
            maxSlope: input.movement.maxSlope,
        });
        const standing =
            ground &&
            prepared.standing([
                ground.position[0],
                ground.position[1] + 0.005,
                ground.position[2],
            ]);
        if (
            !standing ||
            distance(end, standing) > 0.25 ||
            !world.covered(end, standing) ||
            prepared.blocked(end, standing) ||
            prepared.world.sweepCapsule(end, standing, profile)
        )
            continue;
        let best:
            | {
                  center: Vec3;
                  segment: number;
                  fraction: number;
                  distance: number;
              }
            | undefined;
        for (
            let segment = loop.repeatFrom;
            segment < loop.segments.length;
            segment++
        ) {
            for (let step = 0; step <= 256; step++) {
                const fraction = step / 256;
                const center = sample(
                    loop.segments[segment].curve,
                    fraction,
                    offset,
                );
                const separation = distance(center, standing);
                if (
                    (!best || separation < best.distance) &&
                    findGoalHit([standing, standing], center, goal.interaction)
                )
                    best = { center, segment, fraction, distance: separation };
            }
        }
        if (!best || best.distance >= goal.interaction.radius) continue;
        const settleSeconds = distance(end, standing) / locomotion.speed;
        return {
            route,
            anchor: guide.anchor,
            terminal: {
                kind: 'moving-collection',
                source: loop.source,
                trajectory: loop,
                position: standing,
                interaction: goal.interaction,
                interception: {
                    center: best.center,
                    segment: best.segment,
                    fraction: best.fraction,
                    overlapAtLeastSeconds:
                        (2 * (goal.interaction.radius - best.distance)) /
                        Math.max(...loop.segments.map(({ speed }) => speed)),
                },
                wait: {
                    action: 'stationary',
                    initialPhase: 'unknown',
                    activation: 'loaded-entity-tick',
                    approachSeconds: route.cost,
                    settleSeconds,
                    maximumSeconds,
                    firstContactBySeconds:
                        route.cost + settleSeconds + maximumSeconds,
                    staminaSpent: 0,
                },
            },
        };
    }
    return null;
}
