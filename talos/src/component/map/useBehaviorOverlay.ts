import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { REGION_DICT } from '@/data/map';
import {
    findBehaviorForMarker,
    type BehaviorOverlay,
} from '@/data/marker/behavior';
import { useMarkerStore } from '@/store/marker';
import { useUserRecordStore } from '@/store/userRecord';
import useRegion from '@/store/region';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { getSharedPointMapCore } from '@/services/map';

const FALLBACK_BEHAVIOR_COLOR = '#ffc428';
const FALLBACK_RELATION_COLOR = '#fffc51';
const MAX_ANIMATION_DURATION = 6000;
const PANE_SHADOW_CLASS = 'talosBehaviorOverlayPane';

type MapPoint = [number, number];

const distance = (a: MapPoint, b: MapPoint) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]);

type BehaviorLine = {
    points: MapPoint[];
    color?: string;
    weight: number;
    opacity: number;
    dash?: [number, number];
    /** Start time in the scene timeline (milliseconds). */
    delay: number;
    /** Time spent revealing this item (milliseconds). */
    duration: number;
    cumulativeLengths: number[];
    totalLength: number;
};

type BehaviorCircle = {
    point: MapPoint;
    color?: string;
    radius: number;
    fillOpacity: number;
    weight: number;
};

type BehaviorScene = {
    lines: BehaviorLine[];
    circles: BehaviorCircle[];
    /** End of the ordered line timeline. */
    timelineDuration: number;
};

const emptyBehaviorScene = (): BehaviorScene => ({
    lines: [],
    circles: [],
    timelineDuration: 0,
});

const lineDurationForDistance = (length: number): number =>
    Math.max(180, Math.min(680, 180 + Math.sqrt(length) * 45));

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

/**
 * Add a line to the scene's serial playback timeline.  Every sidecar
 * segment is already ordered by the exporter, so the renderer only needs to
 * assign a start time and never has to infer route topology on the client.
 */
const appendLine = (
    scene: BehaviorScene,
    points: MapPoint[],
    options: {
        weight: number;
        opacity: number;
        color?: string;
        dash?: [number, number];
        duration?: number;
    },
): void => {
    if (points.length < 2) return;
    const probe = createLine(points, {
        weight: options.weight,
        opacity: options.opacity,
        color: options.color,
        dash: options.dash,
        delay: scene.timelineDuration,
        duration: 0,
    });
    if (probe.totalLength <= 1e-6) return;

    // Keep short branches quick while giving long travel segments enough time
    // to read.  Durations are intentionally bounded so a dense route cannot
    // pin the animation loop for an unreasonable amount of time.
    const duration =
        options.duration ?? lineDurationForDistance(probe.totalLength);
    const line = { ...probe, duration };
    scene.lines.push(line);
    scene.timelineDuration += duration;
};

type LineOptions = {
    weight: number;
    opacity: number;
    color?: string;
    dash?: [number, number];
    duration?: number;
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
            color: options.color,
            dash: options.dash,
            delay: start,
            duration: 0,
        });
        if (probe.totalLength <= 1e-6) return;
        const duration =
            options.duration ?? lineDurationForDistance(probe.totalLength);
        scene.lines.push({ ...probe, duration });
        longest = Math.max(longest, duration);
    });
    scene.timelineDuration += longest;
};

// Sidecar paths contain only RDP key points. Interpolate between them at
// render time so the map stays compact while the visible path remains gentle.
const smoothPath = (points: MapPoint[], closed: boolean): MapPoint[] => {
    if (points.length < 3) return points;
    const source =
        closed && distance(points[0], points[points.length - 1]) < 0.001
            ? points.slice(0, -1)
            : points;
    if (source.length < 3) return points;
    const segmentCount = closed ? source.length : source.length - 1;
    // Key points stay compact in the sidecar; add only enough render samples
    // to hide segmentation while keeping the canvas scene inexpensive.
    const subdivisions = source.length <= 5 ? 6 : source.length <= 10 ? 4 : 3;
    const result: MapPoint[] = [];
    const pointAt = (index: number): MapPoint => {
        if (closed) return source[(index + source.length) % source.length];
        return source[Math.max(0, Math.min(source.length - 1, index))];
    };
    const interpolate = (
        p0: MapPoint,
        p1: MapPoint,
        p2: MapPoint,
        p3: MapPoint,
        amount: number,
    ): MapPoint => {
        // Centripetal Catmull-Rom avoids the overshoot that uniform Catmull-Rom
        // produces around tight triangles and at an open path's endpoints.
        const alpha = 0.5;
        const knot = (a: MapPoint, b: MapPoint) =>
            Math.pow(Math.max(distance(a, b), 1e-4), alpha);
        const t0 = 0;
        const t1 = t0 + knot(p0, p1);
        const t2 = t1 + knot(p1, p2);
        const t3 = t2 + knot(p2, p3);
        const t = t1 + amount * (t2 - t1);
        const blend = (a: MapPoint, b: MapPoint, ta: number, tb: number) =>
            a.map(
                (value, axis) =>
                    value +
                    ((t - ta) / Math.max(tb - ta, 1e-4)) * (b[axis] - value),
            ) as MapPoint;
        const a1 = blend(p0, p1, t0, t1);
        const a2 = blend(p1, p2, t1, t2);
        const a3 = blend(p2, p3, t2, t3);
        const b1 = blend(a1, a2, t0, t2);
        const b2 = blend(a2, a3, t1, t3);
        return blend(b1, b2, t1, t2);
    };
    for (let index = 0; index < segmentCount; index += 1) {
        const p0 = pointAt(index - 1);
        const p1 = pointAt(index);
        const p2 = pointAt(index + 1);
        const p3 = pointAt(index + 2);
        for (let step = 0; step < subdivisions; step += 1) {
            const t = step / subdivisions;
            result.push(interpolate(p0, p1, p2, p3, t));
        }
    }
    if (closed) result.push(result[0]);
    else result.push(source[source.length - 1]);
    return result;
};

type BehaviorCanvasLayer = L.Layer & {
    setScene: (scene: BehaviorScene, animate: boolean) => void;
};

const createBehaviorCanvasLayer = (): BehaviorCanvasLayer => {
    let map: L.Map | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let context: CanvasRenderingContext2D | null = null;
    let behaviorColor = FALLBACK_BEHAVIOR_COLOR;
    let scene = emptyBehaviorScene();
    let startedAt = 0;
    let animationFrame: number | null = null;
    let animationActive = false;
    let generation = 0;
    let animationEndAt = 0;
    let origin = new L.Point(0, 0);
    let baseCenter: L.LatLng | null = null;
    let baseZoom = 0;
    let projectionDirty = true;
    let projectedScene: BehaviorScene | null = null;
    let projectedLines: Array<{
        points: L.Point[];
        cumulativeLengths: number[];
        totalLength: number;
    }> = [];
    let projectedCircles: L.Point[] = [];
    let timelineScale = 1;
    const padding = 0.2;

    const resize = () => {
        if (!map || !canvas || !context) return;
        const size = map.getSize();
        const ratio = window.devicePixelRatio || 1;
        const boundsSize = size.multiplyBy(1 + padding * 2);
        const nextOrigin = map.containerPointToLayerPoint(
            size.multiplyBy(-padding),
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

    const drawLine = (
        line: BehaviorLine,
        projection: {
            points: L.Point[];
            cumulativeLengths: number[];
            totalLength: number;
        },
        progress: number,
    ) => {
        const points = projection.points;
        if (!context || points.length < 2 || progress <= 0) return;
        if (projection.totalLength <= 0) return;
        const target = projection.totalLength * Math.min(1, progress);
        let remaining = target;
        context.save();
        context.globalAlpha = line.opacity;
        context.strokeStyle = line.color ?? behaviorColor;
        context.lineWidth = line.weight;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.setLineDash(line.dash ?? []);
        context.beginPath();
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
            const ratio = Math.max(0, remaining / Math.max(segment, 1e-6));
            context.lineTo(
                start.x + (end.x - start.x) * ratio,
                start.y + (end.y - start.y) * ratio,
            );
            break;
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
        resize();
        ensureProjection();
        const ratio = window.devicePixelRatio || 1;
        activeContext.clearRect(
            0,
            0,
            activeCanvas.width / ratio,
            activeCanvas.height / ratio,
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
            if (projection) drawLine(line, projection, lineProgress);
        });
        scene.circles.forEach((circle, index) => {
            const point = projectedCircles[index];
            if (!point) return;
            activeContext.save();
            activeContext.globalAlpha = 1;
            activeContext.beginPath();
            activeContext.arc(point.x, point.y, circle.radius, 0, Math.PI * 2);
            activeContext.lineWidth = circle.weight;
            activeContext.strokeStyle = circle.color ?? behaviorColor;
            activeContext.stroke();
            if (circle.fillOpacity > 0) {
                activeContext.globalAlpha = circle.fillOpacity;
                activeContext.fillStyle = circle.color ?? behaviorColor;
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
        draw();
    };
    const animateZoom = (event: { center: L.LatLng; zoom: number }) => {
        if (!map || !canvas || !baseCenter) return;
        const scale = map.getZoomScale(event.zoom, baseZoom);
        const viewHalf = map.getSize().multiplyBy(0.5 + padding);
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
        canvas.className = 'talosBehaviorCanvas';
        canvas.classList.add('leaflet-zoom-animated');
        canvas.style.pointerEvents = 'none';
        canvas.style.position = 'absolute';
        canvas.style.left = '0';
        canvas.style.top = '0';
        canvas.style.zIndex = '470';
        canvas.classList.add(PANE_SHADOW_CLASS);
        context = canvas.getContext('2d');
        nextMap.getPanes().mapPane.appendChild(canvas);
        const paletteColor = getComputedStyle(canvas)
            .getPropertyValue('--talos-behavior-color')
            .trim();
        if (paletteColor) behaviorColor = paletteColor;
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
        map = null;
        projectedScene = null;
        projectedLines = [];
        projectedCircles = [];
        return layer;
    };
    layer.setScene = (nextScene, animate) => {
        generation += 1;
        if (animationFrame !== null)
            window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
        scene = nextScene;
        projectionDirty = true;
        projectedScene = null;
        animationActive = animate && nextScene.lines.length > 0;
        timelineScale =
            animationActive &&
            nextScene.timelineDuration > MAX_ANIMATION_DURATION
                ? MAX_ANIMATION_DURATION / nextScene.timelineDuration
                : 1;
        startedAt = performance.now();
        animationEndAt = animationActive
            ? nextScene.timelineDuration * timelineScale + 100
            : 0;
        draw(startedAt);
        if (animationActive) schedule();
    };
    return layer;
};

const renderRecord = (
    scene: BehaviorScene,
    record: BehaviorOverlay,
    selectedId: string,
) => {
    if (record.kind === 'relation') {
        const selectedIsAnchor = record.anchorId === selectedId;
        // The opposite endpoint is intentionally drawn from sidecar
        // coordinates even when its marker type is filtered or not loaded.
        const endpoint = selectedIsAnchor ? record.targetPos : record.anchorPos;
        appendLine(scene, [record.anchorPos, record.targetPos], {
            weight: 2.5,
            opacity: 1,
            color: FALLBACK_RELATION_COLOR,
            dash: [5, 5],
        });
        scene.circles.push({
            point: endpoint,
            color: FALLBACK_RELATION_COLOR,
            radius: 5,
            fillOpacity: 1,
            weight: 1,
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
            const options: LineOptions = {
                weight: isDash ? 1.7 : 2.75,
                opacity: isDash ? 0.95 : 1,
                ...(isDash ? { dash: [4, 5] as [number, number] } : {}),
            };
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
                    radius: 3.5,
                    fillOpacity: 0,
                    weight: 1,
                });
            });
            if (stage.mode === 'branch' && stage.center) {
                scene.circles.push({
                    point: stage.center,
                    radius: 4,
                    fillOpacity: 1,
                    weight: 1.5,
                });
            }
        });
        return;
    }
    if (record.kind === 'unlock-group') {
        record.helpers.forEach((helper) => {
            appendLine(scene, [record.anchorPos, helper.pos], {
                weight: 2,
                opacity: 1,
                dash: [3, 4],
            });
            scene.circles.push({
                point: helper.pos,
                radius: 5,
                fillOpacity: 1,
                weight: 1,
            });
        });
        return;
    }
    if (record.points.length > 1) {
        const points = smoothPath(record.points, record.closed);
        appendLine(scene, points, { weight: 2.5, opacity: 1 });
    }
};

export function useBehaviorOverlay(map: L.Map | null) {
    const currentPoint = useMarkerStore((state) => state.currentActivePoint);
    const currentRegion = useRegion((state) => state.currentRegionKey);
    const activeFilter = useMarkerStore((state) => state.filter);
    // Subscribe to the current marker's membership only.  Watching the full
    // progress array would rebuild and replay an uncollected overlay whenever
    // an unrelated marker is collected.
    const currentPointActive = useUserRecordStore((state) =>
        currentPoint ? state.activePoints.includes(currentPoint.id) : false,
    );
    const progressEnabled = useUiPrefsStore(
        (state) => state.prefsMarkerProgressEnabled,
    );
    const hideCompletedMarkers = useUiPrefsStore(
        (state) => state.prefsHideCompletedMarkers,
    );
    const layerRef = useRef<BehaviorCanvasLayer | null>(null);
    const requestRef = useRef(0);
    const animationStateRef = useRef<{
        id: string | null;
        region: string | null;
        collected: boolean;
    }>({
        id: null,
        region: null,
        collected: false,
    });
    const [regionRevision, setRegionRevision] = useState(0);

    useEffect(() => {
        if (!map) return;
        // Keep the single canvas in Leaflet's mapPane transform tree so it
        // follows the tile and marker layers through pan and zoom.
        const layer = createBehaviorCanvasLayer().addTo(map);
        layerRef.current = layer;
        const clear = () => {
            requestRef.current += 1;
            getSharedPointMapCore()?.markerLayer.clearBehaviorTemporaryMarkers();
            // MapCore removes every Leaflet layer while switching regions. The
            // behavior layer is intentionally owned by this hook, so restore
            // it here after the switch completes instead of leaving a stale
            // Layer reference with no canvas attached to the map.
            layer.setScene(emptyBehaviorScene(), false);
            if (!map.hasLayer(layer)) layer.addTo(map);
            // The selected marker can remain unchanged while MapCore switches
            // regions. Re-run the loader after the layer has been remounted.
            setRegionRevision((revision) => revision + 1);
        };
        map.on('talos:regionSwitched', clear);
        return () => {
            map.off('talos:regionSwitched', clear);
            requestRef.current += 1;
            getSharedPointMapCore()?.markerLayer.clearBehaviorTemporaryMarkers();
            layer.remove();
            layerRef.current = null;
        };
    }, [map]);

    useEffect(() => {
        const layer = layerRef.current;
        if (!layer) return;
        // A new selection owns the behavior visibility lease. Clear every
        // previous lease before starting the next asynchronous sidecar load;
        // ensureMarkerVisible records visibility synchronously, so an older
        // in-flight request cannot leave a stale marker behind.
        const markerLayer = getSharedPointMapCore()?.markerLayer;
        markerLayer?.clearBehaviorTemporaryMarkers();
        requestRef.current += 1;
        const requestId = requestRef.current;
        const pointId = currentPoint?.id ?? null;
        // A marker object is recreated when its detail view is reopened. Keep
        // animation state keyed by the stable id and region so that reopening
        // the same marker does not restart a long route. Progress is ignored
        // when its preference is disabled because collection state is then not
        // part of the active UI contract.
        const collected = Boolean(
            progressEnabled && currentPoint && currentPointActive,
        );
        const previous = animationStateRef.current;
        const selectionChanged =
            previous.id !== pointId || previous.region !== currentRegion;
        const becameUncollected =
            previous.id === pointId &&
            previous.region === currentRegion &&
            previous.collected &&
            !collected;
        const animate =
            Boolean(pointId) &&
            !collected &&
            (selectionChanged || becameUncollected);
        animationStateRef.current = {
            id: pointId,
            region: currentRegion ?? null,
            collected,
        };
        if (!map || !currentPoint || !currentRegion) {
            layer.setScene(emptyBehaviorScene(), false);
            return;
        }
        const region = REGION_DICT[currentRegion];
        if (!region?.subregions.includes(currentPoint.subregId)) {
            layer.setScene(emptyBehaviorScene(), false);
            return;
        }
        void findBehaviorForMarker(currentPoint.subregId, currentPoint.id)
            .then((records) => {
                if (
                    requestRef.current !== requestId ||
                    layerRef.current !== layer
                )
                    return;
                const scene = emptyBehaviorScene();
                records.forEach((record) => {
                    renderRecord(scene, record, currentPoint.id);
                });
                layer.setScene(scene, animate);

                // Relations are symmetric in the sidecar. Show the opposite
                // formal marker when its type is filtered out, while keeping
                // the marker store and persisted filter untouched.
                const relatedIds = records
                    .filter(
                        (
                            record,
                        ): record is Extract<
                            BehaviorOverlay,
                            { kind: 'relation' }
                        > => record.kind === 'relation',
                    )
                    .map((record) =>
                        record.anchorId === currentPoint.id
                            ? record.targetId
                            : record.anchorId,
                    )
                    .filter(
                        (id, index, ids) =>
                            id !== currentPoint.id && ids.indexOf(id) === index,
                    );

                if (markerLayer && relatedIds.length > 0) {
                    void Promise.all(
                        relatedIds.map(async (relatedId) => {
                            // Region changes can finish sidecar loading before
                            // the formal marker layers are mounted. Retry for
                            // a short bounded window, just like navigation's
                            // existing marker wait, then give up quietly.
                            for (let attempt = 0; attempt < 20; attempt += 1) {
                                if (requestRef.current !== requestId) return;
                                try {
                                    const shown =
                                        await markerLayer.ensureMarkerVisible(
                                            relatedId,
                                            { source: 'behavior' },
                                        );
                                    if (shown) return;
                                } catch {
                                    // A missing marker or a cluster transition
                                    // is isolated to this visibility hint.
                                }
                                await new Promise<void>((resolve) =>
                                    window.setTimeout(resolve, 50),
                                );
                            }
                        }),
                    ).catch(() => {
                        // Keep sidecar rendering independent from marker DOM
                        // creation and cluster animation failures.
                    });
                }
            })
            .catch(() => {
                // A missing/corrupt sidecar must never break marker rendering.
                // Only clear if this request is still the active one.
                if (
                    requestRef.current === requestId &&
                    layerRef.current === layer
                ) {
                    layer.setScene(emptyBehaviorScene(), false);
                }
            });
    }, [
        map,
        currentPoint,
        currentRegion,
        currentPointActive,
        progressEnabled,
        hideCompletedMarkers,
        activeFilter,
        regionRevision,
    ]);
}
