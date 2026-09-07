import L from 'leaflet';

export type CubicGeometry = {
    /** Segment start point. */
    p0: L.Point;
    /** First Bezier control point. */
    p1: L.Point;
    /** Second Bezier control point. */
    p2: L.Point;
    /** Segment end point. */
    p3: L.Point;
};

export type ProjectedCubic = CubicGeometry & {
    /** Approximate cumulative arc lengths at uniform parameter samples. */
    sampleLengths: number[];
    /** Arc-length offset of this segment in its complete route. */
    startLength: number;
    /** Approximate segment arc length in CSS pixels. */
    length: number;
};

/** Smallest stable pivot accepted by the tridiagonal solvers. */
const SPLINE_PIVOT_EPSILON = 1e-9;
/** Pixel distance below which adjacent projected knots are treated as equal. */
const DUPLICATE_POINT_EPSILON = 0.01;
/** Uniform samples per cubic used to approximate arc length. */
const ARC_LENGTH_SAMPLE_COUNT = 24;
/** Denominator floor used when clipping a cubic parameter interval. */
const PARAMETER_DIVISOR_EPSILON = 1e-6;
/** Minimum projected curve length retained for rendering, in CSS pixels. */
const MIN_PROJECTED_CURVE_LENGTH = 0.01;

const lerpPoint = (from: L.Point, to: L.Point, amount: number): L.Point =>
    new L.Point(
        from.x + (to.x - from.x) * amount,
        from.y + (to.y - from.y) * amount,
    );

const cubicPoint = (curve: CubicGeometry, amount: number): L.Point => {
    const inverse = 1 - amount;
    return new L.Point(
        inverse ** 3 * curve.p0.x +
            3 * inverse ** 2 * amount * curve.p1.x +
            3 * inverse * amount ** 2 * curve.p2.x +
            amount ** 3 * curve.p3.x,
        inverse ** 3 * curve.p0.y +
            3 * inverse ** 2 * amount * curve.p1.y +
            3 * inverse * amount ** 2 * curve.p2.y +
            amount ** 3 * curve.p3.y,
    );
};

const splitCubic = (
    curve: CubicGeometry,
    amount: number,
): [CubicGeometry, CubicGeometry] => {
    const p01 = lerpPoint(curve.p0, curve.p1, amount);
    const p12 = lerpPoint(curve.p1, curve.p2, amount);
    const p23 = lerpPoint(curve.p2, curve.p3, amount);
    const p012 = lerpPoint(p01, p12, amount);
    const p123 = lerpPoint(p12, p23, amount);
    const middle = lerpPoint(p012, p123, amount);
    return [
        { p0: curve.p0, p1: p01, p2: p012, p3: middle },
        { p0: middle, p1: p123, p2: p23, p3: curve.p3 },
    ];
};

export const cubicBetween = (
    curve: CubicGeometry,
    start: number,
    end: number,
): CubicGeometry => {
    const clampedStart = Math.max(0, Math.min(1, start));
    const clampedEnd = Math.max(clampedStart, Math.min(1, end));
    if (clampedStart <= 0 && clampedEnd >= 1) return curve;
    const [, right] = splitCubic(curve, clampedStart);
    const relativeEnd =
        (clampedEnd - clampedStart) /
        Math.max(1 - clampedStart, PARAMETER_DIVISOR_EPSILON);
    const [middle] = splitCubic(right, relativeEnd);
    return middle;
};

const solveTridiagonal = (
    lower: number[],
    diagonal: number[],
    upper: number[],
    rhs: number[],
): number[] | null => {
    const size = rhs.length;
    if (size === 0) return [];
    const b = diagonal.slice();
    const d = rhs.slice();
    const c = upper.slice();
    for (let index = 1; index < size; index += 1) {
        const pivot = b[index - 1];
        if (!Number.isFinite(pivot) || Math.abs(pivot) < SPLINE_PIVOT_EPSILON)
            return null;
        const factor = lower[index - 1] / pivot;
        b[index] -= factor * c[index - 1];
        d[index] -= factor * d[index - 1];
    }
    if (
        !Number.isFinite(b[size - 1]) ||
        Math.abs(b[size - 1]) < SPLINE_PIVOT_EPSILON
    )
        return null;
    const result = Array<number>(size).fill(0);
    result[size - 1] = d[size - 1] / b[size - 1];
    for (let index = size - 2; index >= 0; index -= 1) {
        if (
            !Number.isFinite(b[index]) ||
            Math.abs(b[index]) < SPLINE_PIVOT_EPSILON
        )
            return null;
        result[index] = (d[index] - c[index] * result[index + 1]) / b[index];
    }
    return result.every(Number.isFinite) ? result : null;
};

const solveCyclicTridiagonal = (
    diagonal: number[],
    rhs: number[],
): number[] | null => {
    const size = rhs.length;
    if (size < 2) return null;
    if (size === 2) {
        // The two cyclic neighbours overlap in a 2-knot loop, so the matrix
        // has off-diagonal values of 2 rather than two separate entries.
        const determinant = diagonal[0] * diagonal[1] - 4;
        if (Math.abs(determinant) < SPLINE_PIVOT_EPSILON) return null;
        return [
            (rhs[0] * diagonal[1] - 2 * rhs[1]) / determinant,
            (diagonal[0] * rhs[1] - 2 * rhs[0]) / determinant,
        ];
    }
    const alpha = 1;
    const beta = 1;
    const gamma = -diagonal[0];
    if (Math.abs(gamma) < SPLINE_PIVOT_EPSILON) return null;
    const adjustedDiagonal = diagonal.slice();
    adjustedDiagonal[0] -= gamma;
    adjustedDiagonal[size - 1] -= (alpha * beta) / gamma;
    const lower = Array<number>(size - 1).fill(1);
    const upper = Array<number>(size - 1).fill(1);
    const x = solveTridiagonal(lower, adjustedDiagonal, upper, rhs);
    if (!x) return null;
    const correction = Array<number>(size).fill(0);
    correction[0] = gamma;
    correction[size - 1] = alpha;
    const z = solveTridiagonal(lower, adjustedDiagonal, upper, correction);
    if (!z) return null;
    const denominator = 1 + z[0] + (beta * z[size - 1]) / gamma;
    if (
        !Number.isFinite(denominator) ||
        Math.abs(denominator) < SPLINE_PIVOT_EPSILON
    )
        return null;
    const factor = (x[0] + (beta * x[size - 1]) / gamma) / denominator;
    const result = x.map((value, index) => value - factor * z[index]);
    return result.every(Number.isFinite) ? result : null;
};

const buildSplineControlCurves = (
    points: L.Point[],
    closed: boolean,
): CubicGeometry[] | null => {
    // Solve the cubic spline control points globally. Unlike local Catmull-Rom
    // handles, this enforces both first- and second-derivative continuity while
    // still interpolating every authored knot (including the selected marker).
    const source = points.filter(
        (point, index) =>
            index === 0 ||
            point.distanceTo(points[index - 1]) > DUPLICATE_POINT_EPSILON,
    );
    if (
        closed &&
        source.length > 1 &&
        source[0].distanceTo(source[source.length - 1]) <
            DUPLICATE_POINT_EPSILON
    ) {
        source.pop();
    }
    if (source.length < 2) return null;

    const segmentCount = closed ? source.length : source.length - 1;
    const rhsX = Array<number>(segmentCount).fill(0);
    const rhsY = Array<number>(segmentCount).fill(0);
    let firstX: number[] | null;
    let firstY: number[] | null;
    if (closed) {
        const diagonal = Array<number>(segmentCount).fill(4);
        for (let index = 0; index < segmentCount; index += 1) {
            const next = source[(index + 1) % source.length];
            rhsX[index] = 4 * source[index].x + 2 * next.x;
            rhsY[index] = 4 * source[index].y + 2 * next.y;
        }
        firstX = solveCyclicTridiagonal(diagonal, rhsX);
        firstY = solveCyclicTridiagonal(diagonal, rhsY);
    } else if (segmentCount === 1) {
        firstX = [(2 * source[0].x + source[1].x) / 3];
        firstY = [(2 * source[0].y + source[1].y) / 3];
    } else {
        const diagonal = Array<number>(segmentCount).fill(4);
        const lower = Array<number>(segmentCount - 1).fill(1);
        const upper = Array<number>(segmentCount - 1).fill(1);
        diagonal[0] = 2;
        diagonal[segmentCount - 1] = 7;
        lower[segmentCount - 2] = 2;
        rhsX[0] = source[0].x + 2 * source[1].x;
        rhsY[0] = source[0].y + 2 * source[1].y;
        for (let index = 1; index < segmentCount - 1; index += 1) {
            rhsX[index] = 4 * source[index].x + 2 * source[index + 1].x;
            rhsY[index] = 4 * source[index].y + 2 * source[index + 1].y;
        }
        rhsX[segmentCount - 1] =
            8 * source[segmentCount - 1].x + source[segmentCount].x;
        rhsY[segmentCount - 1] =
            8 * source[segmentCount - 1].y + source[segmentCount].y;
        firstX = solveTridiagonal(lower, diagonal, upper, rhsX);
        firstY = solveTridiagonal(lower, diagonal, upper, rhsY);
    }
    if (!firstX || !firstY) return null;
    const first = firstX.map((x, index) => new L.Point(x, firstY[index]));
    const second = first.map((control, index) => {
        const end = source[(index + 1) % source.length];
        const nextFirst = closed
            ? first[(index + 1) % first.length]
            : index < first.length - 1
              ? first[index + 1]
              : null;
        return nextFirst
            ? new L.Point(2 * end.x - nextFirst.x, 2 * end.y - nextFirst.y)
            : new L.Point(
                  (source[source.length - 1].x + control.x) / 2,
                  (source[source.length - 1].y + control.y) / 2,
              );
    });
    return first.map((firstControl, index) => {
        const end = source[(index + 1) % source.length];
        return {
            p0: source[index],
            p1: firstControl,
            p2: second[index],
            p3: end,
        };
    });
};

export const buildProjectedCurves = (
    points: L.Point[],
    closed: boolean,
): ProjectedCubic[] => {
    const controlCurves = buildSplineControlCurves(points, closed);
    if (!controlCurves) return [];
    const curves: ProjectedCubic[] = [];
    let startLength = 0;
    for (const curve of controlCurves) {
        const sampleLengths = [0];
        let previous = curve.p0;
        let length = 0;
        for (let step = 1; step <= ARC_LENGTH_SAMPLE_COUNT; step += 1) {
            const sample = cubicPoint(curve, step / ARC_LENGTH_SAMPLE_COUNT);
            length += previous.distanceTo(sample);
            previous = sample;
            sampleLengths.push(length);
        }
        if (length <= MIN_PROJECTED_CURVE_LENGTH) continue;
        curves.push({
            ...curve,
            sampleLengths,
            startLength,
            length,
        });
        startLength += length;
    }
    return curves;
};

export const cubicTAtLength = (
    curve: ProjectedCubic,
    localLength: number,
): number => {
    const target = Math.max(0, Math.min(curve.length, localLength));
    let low = 1;
    let high = curve.sampleLengths.length - 1;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (curve.sampleLengths[middle] < target) low = middle + 1;
        else high = middle;
    }
    const end = curve.sampleLengths[low];
    if (target <= end) {
        const start = curve.sampleLengths[low - 1];
        const ratio =
            (target - start) / Math.max(end - start, PARAMETER_DIVISOR_EPSILON);
        return (low - 1 + ratio) / (curve.sampleLengths.length - 1);
    }
    return 1;
};
