import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { REGION_DICT } from '@/data/map';
import { findBehaviorForMarker } from '@/data/marker/behavior';
import { getSharedPointMapCore } from '@/services/map';
import { useMarkerStore } from '@/store/marker';
import useRegion from '@/store/region';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { useUserRecordStore } from '@/store/userRecord';
import {
    createBehaviorCanvasLayer,
    type BehaviorCanvasLayer,
} from './BehaviorCanvasLayer';
import { emptyBehaviorScene, renderRecord } from './behaviorScene';

type MarkerLayer = NonNullable<
    ReturnType<typeof getSharedPointMapCore>
>['markerLayer'];

/** Maximum attempts while waiting for a related marker layer to mount. */
const RELATED_MARKER_RETRY_COUNT = 20;
/** Delay between related-marker mount attempts, in milliseconds. */
const RELATED_MARKER_RETRY_DELAY = 50;

const loadBehaviorOverlay = async ({
    subregionId,
    pointId,
    layer,
    markerLayer,
    animate,
    collected,
    isCurrent,
}: {
    /** Sidecar partition containing the selected marker. */
    subregionId: string;
    /** Stable ID of the selected marker. */
    pointId: string;
    /** Canvas layer that receives the assembled behavior scene. */
    layer: BehaviorCanvasLayer;
    /** Marker layer used for temporary relation endpoint visibility. */
    markerLayer?: MarkerLayer;
    /** Whether the one-shot reveal timeline should play. */
    animate: boolean;
    /** Whether marker progress currently treats the selection as collected. */
    collected: boolean;
    /** Request-generation guard preventing stale async writes. */
    isCurrent: () => boolean;
}) => {
    try {
        const records = await findBehaviorForMarker(subregionId, pointId);
        if (!isCurrent()) return;

        const scene = emptyBehaviorScene();
        records.forEach((record) => renderRecord(scene, record, pointId));
        const hasTrajectory = records.some(
            (record) => record.kind === 'trajectory',
        );
        layer.setScene(scene, animate, !collected || hasTrajectory);

        if (!markerLayer) return;
        const relatedIds = new Set<string>();
        records.forEach((record) => {
            if (record.kind !== 'relation') return;
            const relatedId =
                record.anchorId === pointId ? record.targetId : record.anchorId;
            if (relatedId !== pointId) relatedIds.add(relatedId);
        });
        await Promise.all(
            [...relatedIds].map(async (relatedId) => {
                for (
                    let attempt = 0;
                    attempt < RELATED_MARKER_RETRY_COUNT;
                    attempt += 1
                ) {
                    if (!isCurrent()) return;
                    try {
                        if (
                            await markerLayer.ensureMarkerVisible(relatedId, {
                                source: 'behavior',
                            })
                        )
                            return;
                    } catch {
                        // Marker mounting and cluster transitions are transient.
                    }
                    await new Promise<void>((resolve) =>
                        window.setTimeout(resolve, RELATED_MARKER_RETRY_DELAY),
                    );
                }
            }),
        );
    } catch {
        if (isCurrent()) layer.setScene(emptyBehaviorScene(), false, false);
    }
};

export function useBehaviorOverlay(map: L.Map | null) {
    const currentPoint = useMarkerStore((state) => state.currentActivePoint);
    const currentRegion = useRegion((state) => state.currentRegionKey);
    const currentPointActive = useUserRecordStore((state) =>
        currentPoint ? state.activePoints.includes(currentPoint.id) : false,
    );
    const progressEnabled = useUiPrefsStore(
        (state) => state.prefsMarkerProgressEnabled,
    );
    const layerRef = useRef<BehaviorCanvasLayer | null>(null);
    const requestRef = useRef(0);
    const animationStateRef = useRef({
        id: null as string | null,
        region: null as string | null,
        collected: false,
    });
    const [regionRevision, setRegionRevision] = useState(0);

    useEffect(() => {
        if (!map) return;
        const layer = createBehaviorCanvasLayer().addTo(map);
        layerRef.current = layer;
        const resetAfterRegionSwitch = () => {
            requestRef.current += 1;
            getSharedPointMapCore()?.markerLayer.clearBehaviorTemporaryMarkers();
            layer.setScene(emptyBehaviorScene(), false, false);
            if (!map.hasLayer(layer)) layer.addTo(map);
            setRegionRevision((revision) => revision + 1);
        };
        map.on('talos:regionSwitched', resetAfterRegionSwitch);
        return () => {
            map.off('talos:regionSwitched', resetAfterRegionSwitch);
            requestRef.current += 1;
            getSharedPointMapCore()?.markerLayer.clearBehaviorTemporaryMarkers();
            layer.remove();
            layerRef.current = null;
        };
    }, [map]);

    useEffect(() => {
        const layer = layerRef.current;
        if (!layer) return;
        const markerLayer = getSharedPointMapCore()?.markerLayer;
        markerLayer?.clearBehaviorTemporaryMarkers();
        const requestId = ++requestRef.current;
        const pointId = currentPoint?.id ?? null;
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

        const region = currentRegion ? REGION_DICT[currentRegion] : undefined;
        if (
            !map ||
            !currentPoint ||
            !region?.subregions.includes(currentPoint.subregId)
        ) {
            layer.setScene(emptyBehaviorScene(), false, false);
            return;
        }
        void loadBehaviorOverlay({
            subregionId: currentPoint.subregId,
            pointId: currentPoint.id,
            layer,
            markerLayer,
            animate,
            collected,
            isCurrent: () =>
                requestRef.current === requestId && layerRef.current === layer,
        });
    }, [
        map,
        currentPoint,
        currentRegion,
        currentPointActive,
        progressEnabled,
        regionRevision,
    ]);
}
