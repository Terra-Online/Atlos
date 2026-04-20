import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import useRegion from '@/store/region';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { REGION_DICT } from '@/data/map';
import trackerIconUrl from '@/assets/images/UI/icon_char.png';
import { clearEndfieldSession, hasEndfieldSessionCookies, readEndfieldSession } from '@/utils/endfield/storage';
import { MapTracker } from '@/utils/endfield/tracker';
import type { PositionResponse } from '@/utils/endfield/types';
import {
    ENDFIELD_TRACKER_CONFIG_UPDATED_EVENT,
    readEndfieldTrackerConfig,
    saveEndfieldTrackerConfig,
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

type RegionTransform = {
    scaleX: number;
    scaleZ: number;
    offsetX: number;
    offsetZ: number;
    rotateClockwise90?: boolean;
};

const REGION_TRANSFORMS: Record<string, RegionTransform> = {
// ONLY FOR TESTING PURPOSES
};

const MAP_ID_TO_REGION_KEY: Record<string, string> = {
    map01: 'Valley_4',
    map02: 'Wuling',
    base01: 'Dijiang',
    dung01: 'Weekraid_1',
    indie07: 'Wuling',
};

const MAP_ID_TO_PROFILE: Record<string, keyof typeof REGION_TRANSFORMS> = {
// TESTING PURPOSES
};


const parseTrackerConfig = (): TrackerConfig | null => {
    const parsed = readEndfieldTrackerConfig();
    if (!parsed || !parsed.enabled) return null;
    return parsed;
};

const getRegionForPayload = (payload: PositionResponse['data']): string => {
    if (payload.mapId && MAP_ID_TO_REGION_KEY[payload.mapId] && REGION_DICT[MAP_ID_TO_REGION_KEY[payload.mapId]]) {
        return MAP_ID_TO_REGION_KEY[payload.mapId];
    }

    if (payload.mapId && REGION_DICT[payload.mapId]) return payload.mapId;
    const currentRegion = useRegion.getState().currentRegionKey;
    if (REGION_DICT[currentRegion]) return currentRegion;
    return 'Valley_4';
};

const convertGamePosition = (
    map: L.Map,
    payload: PositionResponse['data'],
): { latLng: L.LatLng; mapX: number; mapZ: number; mode: string } => {
    const regionKey = getRegionForPayload(payload);
    const regionConfig = REGION_DICT[regionKey];
    const maxZoom = regionConfig?.maxZoom ?? Math.floor(map.getMaxZoom());

    const mapId = (payload.mapId || '').toLowerCase();
    const levelId = (payload.levelId || '').toLowerCase();
    const profileKey: keyof typeof REGION_TRANSFORMS =
        MAP_ID_TO_PROFILE[mapId]
        ?? ((levelId.includes('wl2') || levelId.includes('wuling2')) ? 'WL2' : 'default');

    const transform = REGION_TRANSFORMS[profileKey] ?? REGION_TRANSFORMS.default;

    let x = payload.pos.x;
    let z = payload.pos.z;

    // DJ special handling from reference script: clockwise 90deg, (x, z) -> (z, -x)
    if (transform.rotateClockwise90) {
        const rotatedX = z;
        const rotatedZ = -x;
        x = rotatedX;
        z = rotatedZ;
    }

    const selected = {
        mapX: x * transform.scaleX + transform.offsetX,
        mapZ: z * transform.scaleZ + transform.offsetZ,
        mode: profileKey,
    };

    return {
        latLng: map.unproject([selected.mapX, selected.mapZ], maxZoom),
        mapX: selected.mapX,
        mapZ: selected.mapZ,
        mode: selected.mode,
    };
};

const createTrackerMarker = (): L.Marker => {
    const icon = L.icon({
        iconUrl: trackerIconUrl,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
    });

    const marker = L.marker([0, 0], {
        icon,
        keyboard: false,
        interactive: false,
        zIndexOffset: 900,
    });

    marker.bindTooltip('', {
        permanent: true,
        direction: 'top',
        offset: [0, -14],
        className: 'endfield-tracker-tooltip',
    });

    return marker;
};

const formatTrackerTooltip = (
    payload: PositionResponse['data'],
    converted: { mapX: number; mapZ: number; latLng: L.LatLng; mode: string },
): string => {
    const x = payload.pos.x.toFixed(1);
    const z = payload.pos.z.toFixed(1);
    const mapId = payload.mapId || 'unknown-map';
    const levelId = payload.levelId || 'unknown-level';
    const convertedX = converted.mapX.toFixed(1);
    const convertedZ = converted.mapZ.toFixed(1);
    const lat = converted.latLng.lat.toFixed(3);
    const lng = converted.latLng.lng.toFixed(3);
    return `<div>RAW X:${x} Z:${z}</div><div>MAP X:${convertedX} Z:${convertedZ} (${lat}, ${lng})</div><div>MODE: ${converted.mode}</div><div>${mapId} / ${levelId}</div>`;
};

const lerp = (from: number, to: number, alpha: number): number => from + (to - from) * alpha;

type AnimationState = {
    rafId: number | null;
    running: boolean;
    from: L.LatLng | null;
    to: L.LatLng | null;
    startTime: number;
};

const ENDFIELD_LOCATOR_TAB_KEY = 'endfield.locator.tab.booted';

const disableLocatorSync = (): void => {
    const current = readEndfieldTrackerConfig();
    if (current) {
        saveEndfieldTrackerConfig({
            ...current,
            enabled: false,
            locatorSync: false,
        });
    }

    clearEndfieldSession();
    useUiPrefsStore.getState().setPrefsLocatorSyncEnabled(false);
};

const shouldDisableLocatorOnTabBoot = (): boolean => {
    const alreadyBooted = sessionStorage.getItem(ENDFIELD_LOCATOR_TAB_KEY);
    sessionStorage.setItem(ENDFIELD_LOCATOR_TAB_KEY, '1');
    return alreadyBooted !== '1';
};

export function useEndfieldMapTracker(map: L.Map | undefined): void {
    const [configVersion, setConfigVersion] = useState(0);
    const trackerRef = useRef<MapTracker | null>(null);
    const markerRef = useRef<L.Marker | null>(null);
    const lastSyncedRegionRef = useRef<string | null>(null);
    const hasCenteredOnFirstUpdateRef = useRef(false);
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

            if (shouldDisableLocatorOnTabBoot()) {
                disableLocatorSync();
                return;
            }

            if (!hasEndfieldSessionCookies()) {
                disableLocatorSync();
                return;
            }

            const marker = createTrackerMarker().addTo(map);
            markerRef.current = marker;

            const session = readEndfieldSession();
            if (!session) {
                disableLocatorSync();
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
                onError: () => {
                    if (!disposed) {
                        disableLocatorSync();
                    }
                },
            });

            trackerRef.current = tracker;

            const onUpdate = (payload: PositionResponse['data']) => {
                if (payload.isOnline === false) return;

                const mappedRegion = payload.mapId ? MAP_ID_TO_REGION_KEY[payload.mapId] : undefined;
                if (config.locatorSync && mappedRegion && REGION_DICT[mappedRegion]) {
                    const store = useRegion.getState();
                    const targetRegion = mappedRegion;
                    if (
                        targetRegion !== store.currentRegionKey
                        && targetRegion !== lastSyncedRegionRef.current
                    ) {
                        store.setCurrentRegion(targetRegion);
                    }
                    lastSyncedRegionRef.current = targetRegion;
                }

                const converted = convertGamePosition(map, payload);
                setTargetPosition(converted.latLng);

                const marker = markerRef.current;
                if (marker) {
                    marker.getTooltip()?.setContent(formatTrackerTooltip(payload, converted));
                }

                if (!hasCenteredOnFirstUpdateRef.current) {
                    hasCenteredOnFirstUpdateRef.current = true;
                    map.panTo(converted.latLng, { animate: true, duration: 0.45 });
                }
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

            hasCenteredOnFirstUpdateRef.current = false;
        };
    }, [map, configVersion]);
}
