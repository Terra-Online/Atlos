import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import useRegion from '@/store/region';
import { REGION_DICT } from '@/data/map';
import { readEndfieldSession } from '@/utils/endfield/storage';
import { MapTracker } from '@/utils/endfield/tracker';
import type { PositionResponse } from '@/utils/endfield/types';
import {
    ENDFIELD_TRACKER_CONFIG_UPDATED_EVENT,
    readEndfieldTrackerConfig,
} from '@/utils/endfield/config';

type TrackerConfig = {
    enabled: boolean;
    baseUrl: string;
    roleId: string;
    serverId: number;
    locatorSync: boolean;
    intervalMs?: number;
    debug?: boolean;
    // Optional conversion controls for projects where API space differs from tile pixel space.
    offsetX?: number;
    offsetZ?: number;
    scaleX?: number;
    scaleZ?: number;
};

const parseTrackerConfig = (): TrackerConfig | null => {
    const parsed = readEndfieldTrackerConfig();
    if (!parsed || !parsed.enabled) return null;
    return parsed;
};

const getRegionForPayload = (payload: PositionResponse['data']): string => {
    if (payload.mapId && REGION_DICT[payload.mapId]) return payload.mapId;
    const currentRegion = useRegion.getState().currentRegionKey;
    if (REGION_DICT[currentRegion]) return currentRegion;
    return 'Valley_4';
};

const convertGamePosition = (
    map: L.Map,
    payload: PositionResponse['data'],
    config: TrackerConfig,
): L.LatLng => {
    const regionKey = getRegionForPayload(payload);
    const regionConfig = REGION_DICT[regionKey];
    const maxZoom = regionConfig?.maxZoom ?? Math.floor(map.getMaxZoom());

    const scaleX = config.scaleX ?? 1;
    const scaleZ = config.scaleZ ?? 1;
    const offsetX = config.offsetX ?? 0;
    const offsetZ = config.offsetZ ?? 0;

    const mapX = payload.pos.x * scaleX + offsetX;
    const mapZ = payload.pos.z * scaleZ + offsetZ;

    return map.unproject([mapX, mapZ], maxZoom);
};

const createTrackerMarker = (): L.Marker => {
    const icon = L.divIcon({
        className: 'endfield-tracker-marker',
        html: '<div style="width:14px;height:14px;border-radius:50%;background:#13d08a;border:2px solid #ffffff;box-shadow:0 0 10px rgba(19,208,138,.8);"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
    });

    return L.marker([0, 0], {
        icon,
        keyboard: false,
        interactive: false,
        zIndexOffset: 900,
    });
};

const lerp = (from: number, to: number, alpha: number): number => from + (to - from) * alpha;

type AnimationState = {
    rafId: number | null;
    running: boolean;
    from: L.LatLng | null;
    to: L.LatLng | null;
    startTime: number;
};

export function useEndfieldMapTracker(map: L.Map | undefined): void {
    const [configVersion, setConfigVersion] = useState(0);
    const trackerRef = useRef<MapTracker | null>(null);
    const markerRef = useRef<L.Marker | null>(null);
    const lastSyncedRegionRef = useRef<string | null>(null);
    const animationRef = useRef<AnimationState>({
        rafId: null,
        running: false,
        from: null,
        to: null,
        startTime: 0,
    });

    useEffect(() => {
        const onConfigUpdated = () => {
            setConfigVersion((v) => v + 1);
        };

        window.addEventListener(ENDFIELD_TRACKER_CONFIG_UPDATED_EVENT, onConfigUpdated as EventListener);
        return () => {
            window.removeEventListener(ENDFIELD_TRACKER_CONFIG_UPDATED_EVENT, onConfigUpdated as EventListener);
        };
    }, []);

    useEffect(() => {
        if (!map) return;

        let disposed = false;

        const cleanupAnimation = () => {
            const state = animationRef.current;
            if (state.rafId !== null) {
                cancelAnimationFrame(state.rafId);
                state.rafId = null;
            }
            state.running = false;
        };

        const setTargetPosition = (target: L.LatLng) => {
            const marker = markerRef.current;
            if (!marker) return;

            const state = animationRef.current;
            const current = marker.getLatLng();
            state.from = current;
            state.to = target;
            state.startTime = performance.now();

            if (state.running) return;

            state.running = true;
            const animate = (now: number) => {
                if (disposed) return;
                const marker = markerRef.current;
                const anim = animationRef.current;
                if (!marker || !anim.from || !anim.to) {
                    anim.running = false;
                    anim.rafId = null;
                    return;
                }

                const durationMs = 900;
                const t = Math.min(1, (now - anim.startTime) / durationMs);
                const eased = 1 - (1 - t) ** 3;
                const next = L.latLng(
                    lerp(anim.from.lat, anim.to.lat, eased),
                    lerp(anim.from.lng, anim.to.lng, eased),
                );
                marker.setLatLng(next);

                if (t >= 1) {
                    anim.running = false;
                    anim.rafId = null;
                    return;
                }

                anim.rafId = requestAnimationFrame(animate);
            };

            state.rafId = requestAnimationFrame(animate);
        };

        const boot = () => {
            const config = parseTrackerConfig();
            if (!config) return;

            const marker = createTrackerMarker().addTo(map);
            markerRef.current = marker;

            const session = readEndfieldSession();
            if (!session) {
                return;
            }

            if (disposed) return;

            const tracker = new MapTracker({
                roleId: config.roleId,
                serverId: config.serverId,
                cred: session.cred,
                token: session.token,
                baseUrl: config.baseUrl,
                intervalMs: config.intervalMs,
                pauseWhenHidden: true,
                debug: config.debug,
            });

            trackerRef.current = tracker;

            const onUpdate = (payload: PositionResponse['data']) => {
                if (payload.isOnline === false) return;

                if (config.locatorSync && payload.mapId && REGION_DICT[payload.mapId]) {
                    const store = useRegion.getState();
                    const targetRegion = payload.mapId;
                    if (
                        targetRegion !== store.currentRegionKey
                        && targetRegion !== lastSyncedRegionRef.current
                    ) {
                        store.setCurrentRegion(targetRegion);
                    }
                    lastSyncedRegionRef.current = targetRegion;
                }

                const latLng = convertGamePosition(map, payload, config);
                setTargetPosition(latLng);
            };

            tracker.subscribe(onUpdate);
            tracker.start();
        };

        boot();

        return () => {
            disposed = true;
            cleanupAnimation();
            trackerRef.current?.destroy();
            trackerRef.current = null;

            if (markerRef.current) {
                markerRef.current.remove();
                markerRef.current = null;
            }
        };
    }, [map, configVersion]);
}
