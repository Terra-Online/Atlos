import { createGroundPlanner } from '@opendfieldmap/ganglia/solver/host';
import {
    sampleJourney,
    type GroundArrival,
    type GroundOptions,
    type Route,
    type Surface,
    type Vec3,
} from '@opendfieldmap/ganglia';

/** Exported by noclip walk-routes; binding includes source, scene, selected state and profile. */
export interface WalkingData {
    version: 1;
    binding: string;
    surfaces: Surface[];
    options: GroundOptions;
}

/** Ground coordinates only. Teleport/base availability comes from the user's planning state. */
export function planWalkingRoute(
    data: WalkingData,
    binding: string,
    starts: GroundArrival[],
    goal: Vec3,
): Route {
    if (data.version !== 1 || !binding || data.binding !== binding)
        throw new Error('Stale walking data');
    return createWalkingPlanner(data, binding).plan(starts, goal);
}

/** Elapsed time starts after arrival. Movement mode and authored timing drive playback. */
export function journeySample(
    route: Extract<Route, { status: 'complete' }>,
    seconds: number,
) {
    return sampleJourney(route, seconds);
}

/** Prepare one immutable scene/state for repeated arbitrary endpoint queries. */
export function createWalkingPlanner(data: WalkingData, binding: string) {
    if (data.version !== 1 || !binding || data.binding !== binding)
        throw new Error('Stale walking data');
    return createGroundPlanner(data.surfaces, data.options);
}
