import L from 'leaflet';
import {
    containsVolume,
    type Navigation,
    type Route,
} from '@endfield-noclip/package-format/navigation';
import { resolveSubregionAtLocation } from '@/services/map/subregionArea';
import {
    convertEFPosition,
    convertMapMarkerToEFGamePosition,
} from '@/services/endfield/locatorTransform';

type Context = Pick<Route, 'scene' | 'level' | 'region' | 'subregion'>;
export const mapPosition = (context: Context, position: readonly number[]) =>
    convertEFPosition({
        mapId: context.scene,
        levelId: context.level,
        pos: { x: position[0], y: position[1], z: position[2] },
        isOnline: true,
    });

/** Keep shared-map position when switching coordinate frames; y remains the authored Unity height. */
export function rebasePosition(
    from: Context,
    to: Context,
    position: readonly number[],
): [number, number, number] {
    if (from.scene === to.scene) return [position[0], position[1], position[2]];
    const p = mapPosition(from, position);
    const profile = mapPosition(to, [0, 0, 0]).mode;
    const q = convertMapMarkerToEFGamePosition(
        { x: p.mapX, y: position[1], z: p.mapZ },
        to.region,
        profile,
    );
    return [q.x, q.y, q.z];
}

export interface Destination {
    route: Route;
    tier: number;
}
export const destinationKey = ({ route, tier }: Destination) =>
    `${route.scene}/${route.level}/${route.subregion}/${tier}`;
const projector = {
    project: (position: L.LatLngExpression, zoom: number) =>
        L.CRS.Simple.latLngToPoint(L.latLng(position), zoom),
};

/** OEM polygons choose the subregion; authored 3D volumes disambiguate overlapping packages. */
export function destinationAt(
    data: Navigation,
    current: Context & { tier: number },
    position: readonly number[],
): Destination | null {
    const p = mapPosition(current, position);
    const subregion = resolveSubregionAtLocation(projector, current.region, [
        p.mapZ,
        p.mapX,
    ]);
    if (!subregion) return null;
    const routes = data.routes.filter(
        (r) => r.region === current.region && r.subregion === subregion,
    );
    const candidates = routes.map((route) => {
        const eye = rebasePosition(current, route, position);
        const volumes = route.volumes
            .filter((v) => v.shapes.some((s) => containsVolume(s, eye)))
            .sort(
                (a, b) =>
                    b.priority - a.priority ||
                    Math.min(
                        ...a.shapes.map((s) => Math.abs(s.size[0] * s.size[2])),
                    ) -
                        Math.min(
                            ...b.shapes.map((s) =>
                                Math.abs(s.size[0] * s.size[2]),
                            ),
                        ),
            );
        const bounds = route.bounds;
        const bounded =
            bounds !== null &&
            eye.every((v, i) => v >= bounds.min[i] && v <= bounds.max[i]);
        return {
            route,
            tier: volumes[0]?.tier ?? 0,
            evidence: volumes.length > 0 || (!route.volumes.length && bounded),
        };
    });
    const independent = candidates.filter(
        (c) => !c.route.seamless && c.evidence,
    );
    // Retain the current scene in a genuine overlap. Never select a package by point proximity.
    const retained = independent.find(
        (c) =>
            c.route.scene === current.scene && c.route.level === current.level,
    );
    if (retained) return retained;
    if (independent.length === 1) return independent[0];
    if (independent.length > 1) return null;
    const seamless = candidates.filter((c) => c.route.seamless);
    if (seamless.length === 1) return seamless[0];
    if (candidates.length === 1) return candidates[0];
    return null;
}

/** A destination must remain stable for 600 ms; gaps and reversals reset the crossing. */
export class Crossing {
    private key = '';
    private since = 0;
    reset() {
        this.key = '';
    }
    update(
        next: Destination | null,
        current: string,
        now: number,
    ): Destination | null {
        const key = next ? destinationKey(next) : '';
        if (!key || key === current) {
            this.reset();
            return null;
        }
        if (key !== this.key) {
            this.key = key;
            this.since = now;
            return null;
        }
        if (now - this.since < 600) return null;
        this.reset();
        return next;
    }
}
