import { type BehaviorOverlay } from '@/data/marker/behavior';
import { getItemIconUrl } from '@/services/assets/resource';

/** Centered icon used for unlock helper bubbles. */
export const UNLOCK_BUBBLE_IMAGE_URL = getItemIconUrl('unlock_bubble');

/** Authored map coordinate in `[latitude, longitude]` order. */
export type MapPoint = [number, number];
/** Named reveal-speed profile for each behavior family. */
type LineSpeed = 'butterfly' | 'line' | 'unlock' | 'aurylene';
/** Palette role that must be resolved after the Canvas enters the DOM. */
export type BehaviorColorRole =
    | 'butterfly'
    | 'relation'
    | 'unlock'
    | 'aurylene';

type LineSpeedProfile = {
    /** Lower reveal-duration bound in milliseconds. */
    minimum: number;
    /** Upper reveal-duration bound in milliseconds. */
    maximum: number;
    /** Milliseconds applied to the square root of source-coordinate length. */
    scale: number;
};

/** Distance-to-duration parameters tuned for each behavior animation. */
const LINE_SPEED_PROFILES: Record<LineSpeed, LineSpeedProfile> = {
    aurylene: { minimum: 320, maximum: 1200, scale: 80 },
    butterfly: { minimum: 160, maximum: 680, scale: 42 },
    unlock: { minimum: 500, maximum: 1400, scale: 90 },
    line: { minimum: 220, maximum: 760, scale: 52 },
};

/** Source-coordinate length below which a line is ignored as degenerate. */
const MIN_LINE_LENGTH = 1e-6;

const distance = (a: MapPoint, b: MapPoint) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]);

export type BehaviorLine = {
    /** Authored latitude/longitude points in traversal order. */
    points: MapPoint[];
    /** Semantic palette token resolved by the Canvas layer. */
    colorRole: BehaviorColorRole;
    /** Stroke width in CSS pixels. */
    weight: number;
    /** Stroke opacity in the inclusive range 0..1. */
    opacity: number;
    /** Alternating dash and gap lengths in CSS pixels. */
    dash?: [number, number];
    /** Render this line as a globally solved C2-continuous cubic path. */
    smooth?: boolean;
    /** Add a looping directional highlight while this scene is active. */
    flow?: boolean;
    /** Join the final authored point back to the first point. */
    closed?: boolean;
    /** Timing profile used to derive reveal duration from route length. */
    speed?: LineSpeed;
    /** Start time in the scene timeline (milliseconds). */
    delay: number;
    /** Time spent revealing this item (milliseconds). */
    duration: number;
    /** Source-coordinate cumulative lengths, beginning with zero. */
    cumulativeLengths: number[];
    /** Total source-coordinate route length. */
    totalLength: number;
};

export type BehaviorCircle = {
    /** Authored latitude/longitude center. */
    point: MapPoint;
    /** Semantic palette token resolved by the Canvas layer. */
    colorRole: BehaviorColorRole;
    /** Optional centered bitmap rendered instead of the vector circle. */
    imageUrl?: string;
    /** Bitmap width and height in CSS pixels. */
    imageSize?: number;
    /** Vector fallback radius in CSS pixels. */
    radius: number;
    /** Vector fallback fill opacity in the inclusive range 0..1. */
    fillOpacity: number;
    /** Vector fallback stroke width in CSS pixels. */
    weight: number;
};

export type BehaviorScene = {
    /** Ordered line render instructions. */
    lines: BehaviorLine[];
    /** Point and bitmap render instructions drawn after all lines. */
    circles: BehaviorCircle[];
    /** End of the ordered line timeline. */
    timelineDuration: number;
};

export const emptyBehaviorScene = (): BehaviorScene => ({
    lines: [],
    circles: [],
    timelineDuration: 0,
});

const lineDurationForDistance = (
    length: number,
    speed: LineSpeed = 'line',
): number => {
    const profile = LINE_SPEED_PROFILES[speed];
    return Math.max(
        profile.minimum,
        Math.min(
            profile.maximum,
            profile.minimum + Math.sqrt(length) * profile.scale,
        ),
    );
};

const createLine = (
    points: MapPoint[],
    options: Omit<BehaviorLine, 'points' | 'cumulativeLengths' | 'totalLength'>,
): BehaviorLine => {
    const cumulativeLengths = [0];
    let totalLength = 0;
    for (let index = 1; index < points.length; index += 1) {
        totalLength += distance(points[index - 1], points[index]);
        cumulativeLengths.push(totalLength);
    }
    return { points, ...options, cumulativeLengths, totalLength };
};

type LineOptions = {
    /** Stroke width in CSS pixels. */
    weight: number;
    /** Stroke opacity in the inclusive range 0..1. */
    opacity: number;
    /** Semantic palette token resolved by the Canvas layer. */
    colorRole: BehaviorColorRole;
    /** Alternating dash and gap lengths in CSS pixels. */
    dash?: [number, number];
    /** Explicit reveal duration in milliseconds. */
    duration?: number;
    /** Distance-to-duration timing profile. */
    speed?: LineSpeed;
    /** Use the global C2-continuous spline renderer. */
    smooth?: boolean;
    /** Draw the looping directional highlight. */
    flow?: boolean;
    /** Solve the spline as a closed loop. */
    closed?: boolean;
};

/** Visual and timing parameters for each behavior line family. */
const LINE_STYLES = {
    /** Formal marker relation: medium, fully opaque, evenly dashed. */
    relation: {
        weight: 2.5,
        opacity: 1,
        colorRole: 'relation',
        dash: [5, 5],
    },
    /** Butterfly route entry: heavier continuous stroke. */
    butterflySolid: {
        weight: 2.75,
        opacity: 1,
        colorRole: 'butterfly',
        speed: 'butterfly',
    },
    /** Butterfly group member: lighter short-dash stroke. */
    butterflyDash: {
        weight: 1.7,
        opacity: 0.95,
        colorRole: 'butterfly',
        speed: 'butterfly',
        dash: [4, 5],
    },
    /** Chest-to-bubble helper: secondary palette, simultaneous short dashes. */
    unlock: {
        weight: 2,
        opacity: 1,
        colorRole: 'unlock',
        speed: 'unlock',
        dash: [3, 4],
    },
    /** Aurylene trajectory: smooth continuous stroke with directional flow. */
    aurylene: {
        weight: 2.5,
        opacity: 1,
        colorRole: 'aurylene',
        speed: 'aurylene',
        smooth: true,
        flow: true,
    },
} satisfies Record<string, LineOptions>;

type CircleOptions = Omit<BehaviorCircle, 'point'>;

/** Visual parameters for vector nodes and image-backed helper bubbles. */
const CIRCLE_STYLES = {
    /** Filled endpoint marking the opposite side of a formal relation. */
    relationEndpoint: {
        colorRole: 'relation',
        radius: 5,
        fillOpacity: 1,
        weight: 1,
    },
    /** Hollow marker for each authored butterfly route point. */
    butterflyPoint: {
        colorRole: 'butterfly',
        radius: 3.5,
        fillOpacity: 0,
        weight: 1,
    },
    /** Filled center marker for a butterfly branch stage. */
    butterflyBranchCenter: {
        colorRole: 'butterfly',
        radius: 4,
        fillOpacity: 1,
        weight: 1.5,
    },
    /** 48px unlock bitmap with a small vector fallback while loading fails. */
    unlockBubble: {
        colorRole: 'unlock',
        imageUrl: UNLOCK_BUBBLE_IMAGE_URL,
        imageSize: 48,
        radius: 5,
        fillOpacity: 1,
        weight: 1,
    },
} satisfies Record<string, CircleOptions>;

/**
 * Add a line to the scene's serial playback timeline.  Every sidecar
 * segment is already ordered by the exporter, so the renderer only needs to
 * assign a start time and never has to infer route topology on the client.
 */
const appendLine = (
    scene: BehaviorScene,
    points: MapPoint[],
    options: LineOptions,
): void => {
    if (points.length < 2) return;
    const probe = createLine(points, {
        weight: options.weight,
        opacity: options.opacity,
        colorRole: options.colorRole,
        dash: options.dash,
        smooth: options.smooth,
        flow: options.flow,
        closed: options.closed,
        speed: options.speed,
        delay: scene.timelineDuration,
        duration: 0,
    });
    if (probe.totalLength <= MIN_LINE_LENGTH) return;

    // Keep short branches quick while giving long travel segments enough time
    // to read.  Durations are intentionally bounded so a dense route cannot
    // pin the animation loop for an unreasonable amount of time.
    const duration =
        options.duration ??
        lineDurationForDistance(probe.totalLength, options.speed);
    const line = { ...probe, duration };
    scene.lines.push(line);
    scene.timelineDuration += duration;
};

/** Add several independent lines at the same timeline instant. */
const appendConcurrentLines = (
    scene: BehaviorScene,
    entries: Array<{ points: MapPoint[]; options: LineOptions }>,
): void => {
    if (entries.length === 0) return;
    const start = scene.timelineDuration;
    let longest = 0;
    entries.forEach(({ points, options }) => {
        if (points.length < 2) return;
        const probe = createLine(points, {
            weight: options.weight,
            opacity: options.opacity,
            colorRole: options.colorRole,
            dash: options.dash,
            smooth: options.smooth,
            flow: options.flow,
            closed: options.closed,
            speed: options.speed,
            delay: start,
            duration: 0,
        });
        if (probe.totalLength <= MIN_LINE_LENGTH) return;
        const duration =
            options.duration ??
            lineDurationForDistance(probe.totalLength, options.speed);
        scene.lines.push({ ...probe, duration });
        longest = Math.max(longest, duration);
    });
    scene.timelineDuration += longest;
};
export const renderRecord = (
    scene: BehaviorScene,
    record: BehaviorOverlay,
    selectedId: string,
) => {
    if (record.kind === 'relation') {
        const selectedIsAnchor = record.anchorId === selectedId;
        // The opposite endpoint is intentionally drawn from sidecar
        // coordinates even when its marker type is filtered or not loaded.
        const endpoint = selectedIsAnchor ? record.targetPos : record.anchorPos;
        appendLine(
            scene,
            [record.anchorPos, record.targetPos],
            LINE_STYLES.relation,
        );
        scene.circles.push({
            point: endpoint,
            ...CIRCLE_STYLES.relationEndpoint,
        });
        return;
    }
    if (record.kind === 'butterfly-path') {
        // `order` is part of the sidecar contract; use it as the source of
        // truth in case a minifier or hand-edited sidecar changes array order.
        const segments = [...record.segments].sort(
            (left, right) => left.order - right.order,
        );
        let index = 0;
        while (index < segments.length) {
            const segment = segments[index];
            const isDash = segment.kind === 'dash';
            const options = isDash
                ? LINE_STYLES.butterflyDash
                : LINE_STYLES.butterflySolid;
            // A branch stage fans out from one center.  Its member dashes are
            // independent and should reveal together; all other segments stay
            // serial, including collinear member-to-member dashes.
            if (
                isDash &&
                segment.phase === 'group-members' &&
                record.stages[segment.stageIndex]?.mode === 'branch'
            ) {
                const entries: Array<{
                    points: MapPoint[];
                    options: LineOptions;
                }> = [];
                const stageIndex = segment.stageIndex;
                while (
                    index < segments.length &&
                    segments[index].phase === 'group-members' &&
                    segments[index].stageIndex === stageIndex &&
                    segments[index].kind === 'dash'
                ) {
                    entries.push({ points: segments[index].points, options });
                    index += 1;
                }
                appendConcurrentLines(scene, entries);
                continue;
            }
            if (
                isDash &&
                segment.phase === 'group-members' &&
                (record.stages[segment.stageIndex]?.mode === 'collinear' ||
                    record.stages[segment.stageIndex]?.mode === 'multiline')
            ) {
                // A collinear group is one continuous traversal. Merge its
                // authored member segments so the reveal speed is based on the
                // group's first/last points instead of restarting per dash.
                const stageIndex = segment.stageIndex;
                const groupPoints = [...segment.points];
                index += 1;
                while (
                    index < segments.length &&
                    segments[index].phase === 'group-members' &&
                    segments[index].stageIndex === stageIndex &&
                    segments[index].kind === 'dash'
                ) {
                    groupPoints.push(...segments[index].points.slice(1));
                    index += 1;
                }
                appendLine(scene, groupPoints, {
                    ...options,
                    duration: lineDurationForDistance(
                        distance(
                            groupPoints[0],
                            groupPoints[groupPoints.length - 1],
                        ),
                        'butterfly',
                    ),
                });
                continue;
            }
            appendLine(scene, segment.points, options);
            index += 1;
        }
        record.stages.forEach((stage) => {
            const points = stage.orderedPoints;
            points.forEach((point) => {
                scene.circles.push({
                    point,
                    ...CIRCLE_STYLES.butterflyPoint,
                });
            });
            if (stage.mode === 'branch' && stage.center) {
                scene.circles.push({
                    point: stage.center,
                    ...CIRCLE_STYLES.butterflyBranchCenter,
                });
            }
        });
        return;
    }
    if (record.kind === 'unlock-group') {
        // Start every chest-to-bubble link at the same timeline position so
        // the unlock fan-out is simultaneous.
        appendConcurrentLines(
            scene,
            record.helpers.map((helper) => ({
                points: [record.anchorPos, helper.pos],
                options: LINE_STYLES.unlock,
            })),
        );
        record.helpers.forEach((helper) => {
            scene.circles.push({
                point: helper.pos,
                ...CIRCLE_STYLES.unlockBubble,
            });
        });
        return;
    }
    if (record.points.length > 1) {
        appendLine(scene, record.points, {
            ...LINE_STYLES.aurylene,
            closed: record.closed,
        });
    }
};
