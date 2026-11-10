import type { GroundArrival, Vec3 } from '@opendfieldmap/ganglia';

export type TravelPoint = {
    id: string;
    level: string;
    scene?: string;
    position: Vec3;
    kind?: string;
    requiresGroundProjection?: boolean;
    groundRange?: [number, number];
};
export type TravelArrival = GroundArrival & {
    kind?: string;
    groundRange?: [number, number];
};

/** Fully enabled previews include newly exported bases without rebuilding AI navigation. */
export function travelArrivals(
    points: TravelPoint[],
    existing: GroundArrival[],
    scene: string,
    level: string | undefined,
    fullyEnabled: boolean,
    target: Vec3,
): TravelArrival[] {
    const previous = new Map(existing.map((arrival) => [arrival.id, arrival]));
    return points
        .flatMap((point): TravelArrival[] => {
            const arrival = previous.get(point.id);
            if (
                (level !== undefined && point.level !== level) ||
                (point.scene !== undefined && point.scene !== scene) ||
                (!arrival && (!fullyEnabled || point.scene !== scene))
            )
                return [];
            const position = arrival?.position ?? point.position;
            if (
                !Array.isArray(position) ||
                position.length !== 3 ||
                !position.every(Number.isFinite)
            )
                return [];
            const range = point.requiresGroundProjection
                ? point.groundRange
                : undefined;
            // Region centres use source height bounds to select their ground support.
            if (
                point.requiresGroundProjection &&
                (!range ||
                    range.length !== 2 ||
                    !range.every(Number.isFinite) ||
                    range[0] > range[1])
            )
                return [];
            return [
                {
                    id: point.id,
                    position,
                    cost: arrival?.cost ?? 0,
                    state: fullyEnabled ? 'available' : arrival!.state,
                    ...(point.kind !== undefined ? { kind: point.kind } : {}),
                    ...(range ? { groundRange: range } : {}),
                },
            ];
        })
        .sort(
            (a, b) =>
                Math.hypot(...a.position.map((v, i) => v - target[i])) -
                Math.hypot(...b.position.map((v, i) => v - target[i])),
        );
}
