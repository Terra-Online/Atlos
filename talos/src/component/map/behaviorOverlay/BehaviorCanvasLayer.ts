import L from 'leaflet';
import {
    emptyBehaviorScene,
    UNLOCK_BUBBLE_IMAGE_URL,
    type BehaviorLine,
    type BehaviorScene,
    type BehaviorColorRole,
    type MapPoint,
} from './behaviorScene';
import {
    buildProjectedCurves,
    cubicBetween,
    cubicTAtLength,
    type ProjectedCubic,
} from './cubicSpline';

/** Maximum total duration of a serial reveal timeline, in milliseconds. */
const MAX_ANIMATION_DURATION = 9000;
/** Duration of one directional highlight loop, in milliseconds. */
const FLOW_CYCLE_DURATION = 1550;
/** Target length of each independently shaded flow segment, in CSS pixels. */
const FLOW_PIECE_LENGTH = 12;
/** Minimum directional-highlight length in root `rem` units. */
const FLOW_HIGHLIGHT_MIN_REM = 1;
/** Maximum directional-highlight length in root `rem` units. */
const FLOW_HIGHLIGHT_MAX_REM = 2.5;
/** Maximum fraction of the complete route occupied by the highlight. */
const FLOW_HIGHLIGHT_MAX_RATIO = 0.15;
/** Number of color stops between the endpoints of each flow segment. */
const FLOW_GRADIENT_SAMPLE_COUNT = 5;
/** Canvas padding around each viewport edge as a fraction of viewport size. */
const CANVAS_VIEW_PADDING_RATIO = 0.2;
/** Canvas stacking level above map paths and below marker interactions. */
const CANVAS_Z_INDEX = '470';
/** CSS class carrying behavior palette tokens and the shared drop shadow. */
const BEHAVIOR_OVERLAY_CLASS = 'behaviorOverlayPane';
/** Smallest drawable projected interval in CSS pixels. */
const MIN_DRAWABLE_LENGTH = 1e-4;
/** Denominator floor used for stable segment interpolation. */
const LENGTH_DIVISOR_EPSILON = 1e-6;
/** Fraction of highlight length used for the full-intensity center. */
const FLOW_HIGHLIGHT_CORE_RATIO = 0.15;
/** Fraction of highlight length used for each smooth transition shoulder. */
const FLOW_HIGHLIGHT_SHOULDER_RATIO = 0.35;

export type BehaviorCanvasLayer = L.Layer & {
    /** Replace the rendered scene and configure reveal/flow animation state. */
    setScene: (
        /** Immutable scene to project and draw. */
        scene: BehaviorScene,
        /** Whether to play the scene's one-shot reveal timeline. */
        animate: boolean,
        /** Whether flow-enabled lines keep their directional highlight active. */
        showFlow: boolean,
    ) => void;
};

type ProjectedLine = {
    /** Authored knots projected to Canvas-local CSS pixels. */
    points: L.Point[];
    /** Cumulative straight-segment lengths in CSS pixels. */
    cumulativeLengths: number[];
    /** Complete projected route length in CSS pixels. */
    totalLength: number;
    /** Globally solved cubic segments for smooth routes. */
    curves?: ProjectedCubic[];
};

/** Red, green and blue channels in the inclusive range 0..255. */
type RgbColor = [number, number, number];

type BehaviorPalette = Record<BehaviorColorRole, string> & {
    /** Moving highlight color for flow-enabled trajectories. */
    flow: string;
};

export const createBehaviorCanvasLayer = (): BehaviorCanvasLayer => {
    let map: L.Map | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let context: CanvasRenderingContext2D | null = null;
    let palette: BehaviorPalette;
    let unlockBubbleImage: HTMLImageElement | null = null;
    let scene = emptyBehaviorScene();
    let startedAt = 0;
    let flowStartedAt = 0;
    let animationFrame: number | null = null;
    let animationActive = false;
    let flowActive = false;
    let generation = 0;
    let animationEndAt = 0;
    let origin = new L.Point(0, 0);
    let baseCenter: L.LatLng | null = null;
    let baseZoom = 0;
    let projectionDirty = true;
    let projectedScene: BehaviorScene | null = null;
    let projectedLines: ProjectedLine[] = [];
    let projectedCircles: L.Point[] = [];
    let timelineScale = 1;
    let pixelRatio = 1;

    const resize = () => {
        if (!map || !canvas || !context) return;
        const size = map.getSize();
        const ratio = window.devicePixelRatio || 1;
        pixelRatio = ratio;
        const boundsSize = size.multiplyBy(1 + CANVAS_VIEW_PADDING_RATIO * 2);
        const nextOrigin = map.containerPointToLayerPoint(
            size.multiplyBy(-CANVAS_VIEW_PADDING_RATIO),
        );
        if (!origin.equals(nextOrigin)) projectionDirty = true;
        origin = nextOrigin;
        const width = Math.max(1, Math.ceil(boundsSize.x * ratio));
        const height = Math.max(1, Math.ceil(boundsSize.y * ratio));
        canvas.style.left = `${origin.x}px`;
        canvas.style.top = `${origin.y}px`;
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
            canvas.style.width = `${boundsSize.x}px`;
            canvas.style.height = `${boundsSize.y}px`;
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
        }
    };

    const appendSmoothRange = (
        projection: ProjectedLine,
        startLength: number,
        endLength: number,
    ): boolean => {
        if (!context || !projection.curves || endLength <= startLength) {
            return false;
        }
        const activeContext = context;
        const start = Math.max(0, startLength);
        const end = Math.min(projection.totalLength, endLength);
        let hasPath = false;
        projection.curves.forEach((curve) => {
            const localStart = Math.max(0, start - curve.startLength);
            const localEnd = Math.min(curve.length, end - curve.startLength);
            if (localEnd <= localStart + MIN_DRAWABLE_LENGTH) return;
            const piece = cubicBetween(
                curve,
                cubicTAtLength(curve, localStart),
                cubicTAtLength(curve, localEnd),
            );
            if (!hasPath) {
                activeContext.moveTo(piece.p0.x, piece.p0.y);
                hasPath = true;
            }
            activeContext.bezierCurveTo(
                piece.p1.x,
                piece.p1.y,
                piece.p2.x,
                piece.p2.y,
                piece.p3.x,
                piece.p3.y,
            );
        });
        return hasPath;
    };

    const parseColor = (value: string): RgbColor => {
        const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (hex) {
            const raw =
                hex[1].length === 3
                    ? hex[1]
                          .split('')
                          .map((part) => part + part)
                          .join('')
                    : hex[1];
            return [
                parseInt(raw.slice(0, 2), 16),
                parseInt(raw.slice(2, 4), 16),
                parseInt(raw.slice(4, 6), 16),
            ];
        }
        const rgb = value.match(
            /rgba?\s*\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)/i,
        );
        if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
        throw new Error(`Unsupported behavior palette color: ${value}`);
    };
    const colorString = (color: RgbColor): string =>
        `rgb(${Math.round(color[0])}, ${Math.round(color[1])}, ${Math.round(color[2])})`;
    const mixColor = (
        from: RgbColor,
        to: RgbColor,
        amount: number,
    ): RgbColor => [
        from[0] + (to[0] - from[0]) * amount,
        from[1] + (to[1] - from[1]) * amount,
        from[2] + (to[2] - from[2]) * amount,
    ];

    const colorForRole = (role: BehaviorColorRole): string => palette[role];

    /**
     * Return the color at a percentage of the route's arc length. The band is
     * periodic, with a broad smoothstep shoulder so adjacent path pieces join
     * without a visible hard edge.
     */
    const flowColorAt = (
        routePercent: number,
        phase: number,
        base: RgbColor,
        highlight: RgbColor,
        highlightRatio: number,
    ): string => {
        const wrapped = ((routePercent - phase + 1.5) % 1) - 0.5;
        const distanceFromCenter = Math.abs(wrapped);
        const shoulder = highlightRatio * FLOW_HIGHLIGHT_SHOULDER_RATIO;
        const core = highlightRatio * FLOW_HIGHLIGHT_CORE_RATIO;
        const intensity =
            distanceFromCenter <= core
                ? 1
                : distanceFromCenter >= core + shoulder
                  ? 0
                  : 1 -
                    ((distanceFromCenter - core) / shoulder) ** 2 *
                        (3 - 2 * ((distanceFromCenter - core) / shoulder));
        return colorString(mixColor(base, highlight, intensity));
    };

    const createFlowGradient = (
        from: L.Point,
        to: L.Point,
        startLength: number,
        endLength: number,
        totalLength: number,
        phase: number,
        base: RgbColor,
        highlight: RgbColor,
        highlightRatio: number,
    ): CanvasGradient | null => {
        if (!context || endLength <= startLength || totalLength <= 0)
            return null;
        const gradient = context.createLinearGradient(
            from.x,
            from.y,
            to.x,
            to.y,
        );
        for (let index = 0; index <= FLOW_GRADIENT_SAMPLE_COUNT; index += 1) {
            const amount = index / FLOW_GRADIENT_SAMPLE_COUNT;
            const routePercent =
                (startLength + (endLength - startLength) * amount) /
                totalLength;
            gradient.addColorStop(
                amount,
                flowColorAt(
                    routePercent,
                    phase,
                    base,
                    highlight,
                    highlightRatio,
                ),
            );
        }
        return gradient;
    };

    const drawFlowingSmoothLine = (
        projection: ProjectedLine,
        target: number,
        now: number,
        baseColor: string,
    ) => {
        if (!context || !projection.curves) return;
        const activeContext = context;
        const base = parseColor(baseColor);
        const highlight = parseColor(palette.flow);
        const rootFontSize = Number.parseFloat(
            window.getComputedStyle(document.documentElement).fontSize,
        );
        const remInPixels = rootFontSize;
        const highlightLength = Math.min(
            projection.totalLength,
            Math.max(
                remInPixels * FLOW_HIGHLIGHT_MIN_REM,
                Math.min(
                    remInPixels * FLOW_HIGHLIGHT_MAX_REM,
                    projection.totalLength * FLOW_HIGHLIGHT_MAX_RATIO,
                ),
            ),
        );
        const highlightRatio = highlightLength / projection.totalLength;
        const phase =
            ((((now - flowStartedAt) / FLOW_CYCLE_DURATION) % 1) + 1) % 1;
        projection.curves.forEach((curve) => {
            const visibleStart = Math.max(0, 0 - curve.startLength);
            const visibleEnd = Math.min(
                curve.length,
                target - curve.startLength,
            );
            if (visibleEnd <= visibleStart + MIN_DRAWABLE_LENGTH) return;
            const pieces = Math.max(
                1,
                Math.ceil(curve.length / FLOW_PIECE_LENGTH),
            );
            for (let index = 0; index < pieces; index += 1) {
                const localStart = Math.max(
                    visibleStart,
                    (curve.length * index) / pieces,
                );
                const localEnd = Math.min(
                    visibleEnd,
                    (curve.length * (index + 1)) / pieces,
                );
                if (localEnd <= localStart + MIN_DRAWABLE_LENGTH) continue;
                const piece = cubicBetween(
                    curve,
                    cubicTAtLength(curve, localStart),
                    cubicTAtLength(curve, localEnd),
                );
                const gradient = createFlowGradient(
                    piece.p0,
                    piece.p3,
                    curve.startLength + localStart,
                    curve.startLength + localEnd,
                    projection.totalLength,
                    phase,
                    base,
                    highlight,
                    highlightRatio,
                );
                if (!gradient) continue;
                activeContext.beginPath();
                activeContext.moveTo(piece.p0.x, piece.p0.y);
                activeContext.bezierCurveTo(
                    piece.p1.x,
                    piece.p1.y,
                    piece.p2.x,
                    piece.p2.y,
                    piece.p3.x,
                    piece.p3.y,
                );
                activeContext.strokeStyle = gradient;
                activeContext.stroke();
            }
        });
    };

    const drawLine = (
        line: BehaviorLine,
        projection: ProjectedLine,
        progress: number,
        now: number,
    ) => {
        const points = projection.points;
        if (!context || points.length < 2 || progress <= 0) return;
        if (projection.totalLength <= 0) return;
        const target = projection.totalLength * Math.min(1, progress);
        context.save();
        context.globalAlpha = line.opacity;
        const flowing = line.flow && flowActive && progress > 0;
        context.lineWidth = line.weight;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.setLineDash(line.dash ?? []);
        if (flowing && line.smooth && projection.curves) {
            drawFlowingSmoothLine(
                projection,
                target,
                now,
                colorForRole(line.colorRole),
            );
            context.restore();
            return;
        }
        context.strokeStyle = colorForRole(line.colorRole);
        context.beginPath();
        if (line.smooth && projection.curves) {
            appendSmoothRange(projection, 0, target);
        } else {
            let remaining = target;
            context.moveTo(points[0].x, points[0].y);
            for (let index = 1; index < points.length; index += 1) {
                const start = points[index - 1];
                const end = points[index];
                const segment =
                    projection.cumulativeLengths[index] -
                    projection.cumulativeLengths[index - 1];
                if (remaining >= segment) {
                    context.lineTo(end.x, end.y);
                    remaining -= segment;
                    continue;
                }
                const ratio = Math.max(
                    0,
                    remaining / Math.max(segment, LENGTH_DIVISOR_EPSILON),
                );
                context.lineTo(
                    start.x + (end.x - start.x) * ratio,
                    start.y + (end.y - start.y) * ratio,
                );
                break;
            }
        }
        context.stroke();
        context.restore();
    };

    const ensureProjection = () => {
        if (!map || (projectedScene === scene && !projectionDirty)) return;
        const activeMap = map;
        const projectPoint = (point: MapPoint) =>
            activeMap.latLngToLayerPoint([point[0], point[1]]).subtract(origin);
        projectedLines = scene.lines.map((line) => {
            const points = line.points.map(projectPoint);
            const curves = line.smooth
                ? buildProjectedCurves(points, Boolean(line.closed))
                : [];
            if (line.smooth && curves.length > 0) {
                const totalLength = curves.reduce(
                    (total, curve) => total + curve.length,
                    0,
                );
                return {
                    points,
                    cumulativeLengths: [0, totalLength],
                    totalLength,
                    curves,
                };
            }
            const cumulativeLengths = [0];
            let totalLength = 0;
            for (let index = 1; index < points.length; index += 1) {
                totalLength += points[index - 1].distanceTo(points[index]);
                cumulativeLengths.push(totalLength);
            }
            return { points, cumulativeLengths, totalLength };
        });
        projectedCircles = scene.circles.map((circle) =>
            projectPoint(circle.point),
        );
        projectedScene = scene;
        projectionDirty = false;
    };

    const draw = (now = performance.now()) => {
        if (!map || !canvas || !context) return;
        const animatingZoom = Boolean(
            (map as unknown as { _animatingZoom?: boolean })._animatingZoom,
        );
        // During Leaflet's zoom transition the existing bitmap is transformed
        // by animateZoom. Reprojecting it at the target zoom in the same frame
        // would apply the scale twice and detach the endpoints.
        if (animatingZoom) return;
        const activeCanvas = canvas;
        const activeContext = context;
        if (projectionDirty) resize();
        ensureProjection();
        activeContext.clearRect(
            0,
            0,
            activeCanvas.width / pixelRatio,
            activeCanvas.height / pixelRatio,
        );
        const elapsed = animationActive
            ? (now - startedAt) / timelineScale
            : Number.POSITIVE_INFINITY;
        scene.lines.forEach((line, index) => {
            const lineProgress = animationActive
                ? 1 -
                  Math.pow(
                      1 -
                          Math.max(
                              0,
                              Math.min(
                                  1,
                                  (elapsed - line.delay) / line.duration,
                              ),
                          ),
                      3,
                  )
                : 1;
            const projection = projectedLines[index];
            if (projection) drawLine(line, projection, lineProgress, now);
        });
        scene.circles.forEach((circle, index) => {
            const point = projectedCircles[index];
            if (!point) return;
            activeContext.save();
            if (
                circle.imageUrl === UNLOCK_BUBBLE_IMAGE_URL &&
                unlockBubbleImage?.complete &&
                unlockBubbleImage.naturalWidth > 0
            ) {
                const size = circle.imageSize ?? circle.radius * 2;
                activeContext.globalAlpha = 1;
                activeContext.drawImage(
                    unlockBubbleImage,
                    point.x - size / 2,
                    point.y - size / 2,
                    size,
                    size,
                );
                activeContext.restore();
                return;
            }
            activeContext.globalAlpha = 1;
            activeContext.beginPath();
            activeContext.arc(point.x, point.y, circle.radius, 0, Math.PI * 2);
            activeContext.lineWidth = circle.weight;
            activeContext.strokeStyle = colorForRole(circle.colorRole);
            activeContext.stroke();
            if (circle.fillOpacity > 0) {
                activeContext.globalAlpha = circle.fillOpacity;
                activeContext.fillStyle = colorForRole(circle.colorRole);
                activeContext.fill();
            }
            activeContext.restore();
        });
    };

    const schedule = () => {
        if (animationFrame !== null) return;
        const token = generation;
        animationFrame = window.requestAnimationFrame((now) => {
            animationFrame = null;
            if (token !== generation) return;
            draw(now);
            if (animationActive && now - startedAt < animationEndAt) {
                schedule();
            } else if (animationActive || flowActive) {
                animationActive = false;
                schedule();
            } else {
                // Keep the final frame deterministic.  `draw` above may have
                // been skipped during a zoom transition, so repaint once
                // after switching to static mode.
                animationActive = false;
                draw(now);
            }
        });
    };

    const redraw = () => {
        projectionDirty = true;
        // Leaflet emits a final `move` immediately after it clears its private
        // `_animatingZoom` flag and before `zoomend`.  Drop the previous
        // zoom transform before reprojecting so that frame cannot combine a
        // target-zoom bitmap with the old scale/offset.
        if (
            map &&
            !(map as unknown as { _animatingZoom?: boolean })._animatingZoom &&
            canvas?.style.transform
        ) {
            canvas.style.transform = '';
        }
        if (
            map &&
            !(map as unknown as { _animatingZoom?: boolean })._animatingZoom
        ) {
            baseCenter = map.getCenter();
            baseZoom = map.getZoom();
        }
        if (animationFrame === null) draw();
    };
    const animateZoom = (event: { center: L.LatLng; zoom: number }) => {
        if (!map || !canvas || !baseCenter) return;
        const scale = map.getZoomScale(event.zoom, baseZoom);
        const viewHalf = map
            .getSize()
            .multiplyBy(0.5 + CANVAS_VIEW_PADDING_RATIO);
        const currentCenterPoint = map.project(baseCenter, event.zoom);
        const newOrigin = (
            map as unknown as {
                _getNewPixelOrigin: (center: L.LatLng, zoom: number) => L.Point;
            }
        )._getNewPixelOrigin(event.center, event.zoom);
        const offset = viewHalf
            .multiplyBy(-scale)
            .add(currentCenterPoint)
            .subtract(newOrigin);
        canvas.style.transform = `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`;
    };
    const finishZoom = () => {
        if (!canvas) return;
        canvas.style.transform = '';
        projectionDirty = true;
        if (map) {
            baseCenter = map.getCenter();
            baseZoom = map.getZoom();
        }
        draw();
    };
    const layer = new L.Layer() as BehaviorCanvasLayer;
    layer.onAdd = (nextMap: L.Map) => {
        map = nextMap;
        projectionDirty = true;
        projectedScene = null;
        projectedLines = [];
        projectedCircles = [];
        canvas = document.createElement('canvas');
        canvas.className = 'behaviorCanvas';
        canvas.classList.add('leaflet-zoom-animated');
        canvas.style.pointerEvents = 'none';
        canvas.style.position = 'absolute';
        canvas.style.left = '0';
        canvas.style.top = '0';
        canvas.style.zIndex = CANVAS_Z_INDEX;
        canvas.classList.add(BEHAVIOR_OVERLAY_CLASS);
        context = canvas.getContext('2d');
        nextMap.getPanes().mapPane.appendChild(canvas);
        const canvasStyle = getComputedStyle(canvas);
        palette = {
            butterfly: canvasStyle
                .getPropertyValue('--behavior-butterfly-color')
                .trim(),
            relation: canvasStyle
                .getPropertyValue('--behavior-relation-color')
                .trim(),
            unlock: canvasStyle
                .getPropertyValue('--behavior-unlock-color')
                .trim(),
            aurylene: canvasStyle
                .getPropertyValue('--behavior-aurylene-color')
                .trim(),
            flow: canvasStyle.getPropertyValue('--behavior-flow-color').trim(),
        };
        unlockBubbleImage = new Image();
        unlockBubbleImage.onload = () => draw();
        unlockBubbleImage.src = UNLOCK_BUBBLE_IMAGE_URL;
        baseCenter = nextMap.getCenter();
        baseZoom = nextMap.getZoom();
        nextMap.on('move resize viewreset', redraw);
        nextMap.on('zoomanim', animateZoom);
        nextMap.on('zoomend', finishZoom);
        draw();
        return layer;
    };
    layer.onRemove = (nextMap: L.Map) => {
        generation += 1;
        if (animationFrame !== null)
            window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
        nextMap.off('move resize viewreset', redraw);
        nextMap.off('zoomanim', animateZoom);
        nextMap.off('zoomend', finishZoom);
        canvas?.remove();
        canvas = null;
        context = null;
        unlockBubbleImage = null;
        map = null;
        animationActive = false;
        flowActive = false;
        projectedScene = null;
        projectedLines = [];
        projectedCircles = [];
        return layer;
    };
    layer.setScene = (nextScene, animate, showFlow) => {
        generation += 1;
        if (animationFrame !== null)
            window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
        scene = nextScene;
        projectionDirty = true;
        projectedScene = null;
        animationActive = animate && nextScene.lines.length > 0;
        flowActive =
            showFlow && nextScene.lines.some((line) => line.flow === true);
        timelineScale =
            animationActive &&
            nextScene.timelineDuration > MAX_ANIMATION_DURATION
                ? MAX_ANIMATION_DURATION / nextScene.timelineDuration
                : 1;
        startedAt = performance.now();
        flowStartedAt = startedAt;
        animationEndAt = animationActive
            ? nextScene.timelineDuration * timelineScale + 100
            : 0;
        draw(startedAt);
        if (animationActive || flowActive) schedule();
    };
    return layer;
};
