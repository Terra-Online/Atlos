/**
 * Game-coordinate LatLng / LatLngBounds. Values stay in Leaflet CRS.Simple
 * semantics (lat = -py/2^maxZoom, lng = px/2^maxZoom); conversion to real
 * mercator lngLat happens only at the MapLibre boundary (see coords.ts).
 */
export class LatLng {
    constructor(
        public lat: number,
        public lng: number,
    ) {}

    equals(other: LatLng): boolean {
        return this.lat === other.lat && this.lng === other.lng;
    }

    clone(): LatLng {
        return new LatLng(this.lat, this.lng);
    }
}

export type LatLngExpression =
    | LatLng
    | [number, number]
    | { lat: number; lng: number };

export const toLatLng = (
    value: LatLngExpression | number,
    lng?: number,
): LatLng => {
    if (typeof value === 'number') return new LatLng(value, lng ?? 0);
    if (value instanceof LatLng) return value;
    if (Array.isArray(value)) return new LatLng(value[0], value[1]);
    return new LatLng(value.lat, value.lng);
};

export const latLng = toLatLng;

export class LatLngBounds {
    constructor(
        public southWest: LatLng,
        public northEast: LatLng,
    ) {}

    static fromCorners(a: LatLngExpression, b: LatLngExpression): LatLngBounds {
        const cornerA = toLatLng(a);
        const cornerB = toLatLng(b);
        return new LatLngBounds(
            new LatLng(
                Math.min(cornerA.lat, cornerB.lat),
                Math.min(cornerA.lng, cornerB.lng),
            ),
            new LatLng(
                Math.max(cornerA.lat, cornerB.lat),
                Math.max(cornerB.lng, cornerB.lng),
            ),
        );
    }

    getSouthWest(): LatLng {
        return this.southWest;
    }

    getNorthEast(): LatLng {
        return this.northEast;
    }

    getWest(): number {
        return this.southWest.lng;
    }

    getEast(): number {
        return this.northEast.lng;
    }

    getSouth(): number {
        return this.southWest.lat;
    }

    getNorth(): number {
        return this.northEast.lat;
    }

    getCenter(): LatLng {
        return new LatLng(
            (this.southWest.lat + this.northEast.lat) / 2,
            (this.southWest.lng + this.northEast.lng) / 2,
        );
    }

    contains(value: LatLngExpression): boolean {
        const point = toLatLng(value);
        return (
            point.lat >= this.getSouth() &&
            point.lat <= this.getNorth() &&
            point.lng >= this.getWest() &&
            point.lng <= this.getEast()
        );
    }

    pad(ratio: number): LatLngBounds {
        const latBuffer =
            ((this.getNorth() - this.getSouth()) * ratio) / 2;
        const lngBuffer = ((this.getEast() - this.getWest()) * ratio) / 2;
        return new LatLngBounds(
            new LatLng(this.getSouth() - latBuffer, this.getWest() - lngBuffer),
            new LatLng(this.getNorth() + latBuffer, this.getEast() + lngBuffer),
        );
    }
}

export type LatLngBoundsExpression =
    | LatLngBounds
    | [LatLngExpression, LatLngExpression];

export const toLatLngBounds = (
    value: LatLngBoundsExpression | LatLngExpression,
    cornerB?: LatLngExpression,
): LatLngBounds => {
    if (value instanceof LatLngBounds) return value;
    if (cornerB !== undefined) {
        return LatLngBounds.fromCorners(value as LatLngExpression, cornerB);
    }
    const pair = value as [LatLngExpression, LatLngExpression];
    return LatLngBounds.fromCorners(pair[0], pair[1]);
};

export const latLngBounds = toLatLngBounds;
