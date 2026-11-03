import {
    planGroundRoute, sampleRoute,
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

/** Animation follows the walking polyline after arrival; teleportation is never drawn as a flight. */
export function walkingPosition(route: Extract<Route, { status: 'complete' }>, seconds: number, speed: number): Vec3 {
    if (!Number.isFinite(speed) || speed <= 0) throw new Error('Invalid walking speed');
    return sampleRoute(route.points, seconds * speed);
}
