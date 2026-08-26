/** Minimal port of Leaflet's L.Point used across the map codebase. */
export class Point {
    constructor(
        public x: number,
        public y: number,
    ) {}

    clone(): Point {
        return new Point(this.x, this.y);
    }

    add(other: Point): Point {
        return new Point(this.x + other.x, this.y + other.y);
    }

    subtract(other: Point): Point {
        return new Point(this.x - other.x, this.y - other.y);
    }

    divideBy(factor: number): Point {
        return new Point(this.x / factor, this.y / factor);
    }

    multiplyBy(factor: number): Point {
        return new Point(this.x * factor, this.y * factor);
    }

    distanceTo(other: Point): number {
        const dx = other.x - this.x;
        const dy = other.y - this.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    equals(other: Point): boolean {
        return this.x === other.x && this.y === other.y;
    }

    round(): Point {
        return new Point(Math.round(this.x), Math.round(this.y));
    }
}

export const toPoint = (x: number | [number, number] | Point, y?: number): Point => {
    if (x instanceof Point) return x;
    if (Array.isArray(x)) return new Point(x[0], x[1]);
    return new Point(x, y ?? 0);
};

export const point = toPoint;
