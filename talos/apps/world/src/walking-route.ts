import {
    planGroundRoute, sampleJourney,
    type GroundArrival, type GroundOptions, type Route, type Surface, type Vec3,
} from '@oem/ganglia';

/** Exported by noclip walk-routes; binding includes source, scene, selected state and profile. */
export interface WalkingData {
    version: 1;
    binding: string;
    surfaces: Surface[];
    options: GroundOptions;
}

/** Ground coordinates only. Teleport/base availability comes from the user's planning state. */
export function planWalkingRoute(data: WalkingData, binding: string, starts: GroundArrival[], goal: Vec3): Route {
    if (data.version !== 1 || !binding || data.binding !== binding) throw new Error('Stale walking data');
    return planGroundRoute(data.surfaces, starts, goal, data.options);
}

/** Elapsed time starts after arrival. Movement mode and authored timing drive playback. */
export function journeySample(route: Extract<Route, { status: 'complete' }>, seconds: number) {
    return sampleJourney(route, seconds);
}
