import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import useRegion from '@/store/region';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { REGION_DICT } from '@/data/map';
import trackerIconUrl from '@/assets/images/UI/icon_char.png';
import { LOCATOR_RETURN_CURRENT_EVENT, useLocatorStore } from '@/component/locator/state';
import { clearEndfieldSession, hasEndfieldSessionCookies, readEndfieldSession } from '@/utils/endfield/storage';
import { MapTracker } from '@/utils/endfield/tracker';
import type { PositionResponse } from '@/utils/endfield/types';
import {
    ENDFIELD_TRACKER_CONFIG_UPDATED_EVENT,
    readEFTrackerConf,
    saveEFTrackerConf,
} from '@/utils/endfield/config';
import styles from './Tracker.module.scss';

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
    VL: {
        scaleX: 0.4687511298,
        scaleZ: 0.4687511298,
        offsetX: 519.6990737,
        offsetZ: -479.9101599,
    },
    WL: {
        scaleX: 0.41397681175575596,
        scaleZ: 0.4123987909522064,
        offsetX: 955.8805906115372,
        offsetZ: -155.59250075860632,
    },
    WL2: {
        scaleX: 0.35414771840391185,
        scaleZ: 0.33417957195526954,
        offsetX: 229.5095336217924,
        offsetZ: -639.5187069784344,
    },
    DJ: {
        scaleX: 2.817109225144681,
        scaleZ: 2.8369668977222067,
        offsetX: 481.07581876506237,
        offsetZ: -528.2046998395613,
    },
    ES: {
        scaleX: 2.1236893194106514,
        scaleZ: 2.1398455301912183,
        offsetX: 613.9427764351295,
        offsetZ: -898.0955173659895,
    },
    default: {
        scaleX: 0.4687511298,
        scaleZ: 0.4687511298,
        offsetX: 519.6990737,
        offsetZ: -476.8398401,
    },
};

const MAP_ID_TO_REGION_KEY: Record<string, string> = {
    map01: 'Valley_4',
    map02: 'Wuling',
    base01: 'Dijiang',
    dung01: 'Weekraid_1',
    indie07: 'Wuling',
};

const MAP_ID_TO_PROFILE: Record<string, keyof typeof REGION_TRANSFORMS> = {
    map01: 'VL',
    map02: 'WL',
    base01: 'DJ',
    dung01: 'ES',
    indie07: 'WL2',
    indie_dg007: 'WL2',
};

const normalizeSceneId = (value?: string | null): string => (value || '').trim().toLowerCase();

const resolveProfileKeyFromPayload = (payload: PositionResponse['data']): keyof typeof REGION_TRANSFORMS => {
    const mapId = normalizeSceneId(payload.mapId);
    const levelId = normalizeSceneId(payload.levelId);

    if (!mapId && !levelId) return 'ES';

    const direct = MAP_ID_TO_PROFILE[mapId];
    if (direct) return direct;

    // Keep profile inference consistent with transCoord.py's startswith rules.
    if (mapId.startsWith('map01') || levelId.startsWith('map01')) return 'VL';
    if (mapId.startsWith('map02') || levelId.startsWith('map02')) return 'WL';
    if (mapId.startsWith('base01') || levelId.startsWith('base01')) return 'DJ';
    if (mapId.startsWith('dung01') || levelId.startsWith('dung01')) return 'ES';

    if (
        mapId.startsWith('indie07')
        || levelId.startsWith('indie07')
        || mapId.includes('indie_dg007')
        || levelId.includes('indie_dg007')
        || mapId.includes('wl2')
        || levelId.includes('wl2')
        || mapId.includes('wuling2')
        || levelId.includes('wuling2')
    ) {
        return 'WL2';
    }

    return 'default';
};

const resolveRegionKeyFromPayload = (payload: PositionResponse['data']): string | null => {
    const mapId = normalizeSceneId(payload.mapId);
    const levelId = normalizeSceneId(payload.levelId);

    if (!mapId && !levelId) return 'Weekraid_1';

    const direct = MAP_ID_TO_REGION_KEY[mapId];
    if (direct && REGION_DICT[direct]) return direct;

    if (mapId.startsWith('map01') || levelId.startsWith('map01')) return 'Valley_4';
    if (mapId.startsWith('map02') || levelId.startsWith('map02')) return 'Wuling';
    if (mapId.startsWith('base01') || levelId.startsWith('base01')) return 'Dijiang';
    if (mapId.startsWith('dung01') || levelId.startsWith('dung01')) return 'Weekraid_1';
    if (
        mapId.startsWith('indie07')
        || levelId.startsWith('indie07')
        || mapId.includes('indie_dg007')
        || levelId.includes('indie_dg007')
    ) {
        return 'Wuling';
    }

    if (mapId && REGION_DICT[mapId]) return mapId;
    return null;
};

const ENDFIELD_TRACKER_PANE = 'talos-endfield-tracker-pane';
const ENDFIELD_TRACKER_LAYER_Z_INDEX = 640;

const ensureTrackerPane = (map: L.Map): string => {
    const existing = map.getPane(ENDFIELD_TRACKER_PANE);
    if (existing) return ENDFIELD_TRACKER_PANE;
    const pane = map.createPane(ENDFIELD_TRACKER_PANE);
    pane.style.zIndex = String(ENDFIELD_TRACKER_LAYER_Z_INDEX);
    pane.style.pointerEvents = 'none';
    return ENDFIELD_TRACKER_PANE;
};


const parseTrackerConfig = (): TrackerConfig | null => {
    const parsed = readEFTrackerConf();
    if (!parsed || !parsed.enabled) return null;
    return parsed;
};

const convertGamePosition = (
    payload: PositionResponse['data'],
): { latLng: L.LatLng; mapX: number; mapZ: number; mode: string } => {
    const profileKey = resolveProfileKeyFromPayload(payload);

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
        // MarkerLayer uses [lat, lng] == [z, x] in CRS.Simple map space.
        // mapX/mapZ are already converted into that same space, no unproject needed.
        latLng: L.latLng(selected.mapZ, selected.mapX),
        mapX: selected.mapX,
        mapZ: selected.mapZ,
        mode: selected.mode,
    };
};

const createTrackerMarker = (pane: string, latLng: L.LatLng): L.Marker => {
    const icon = L.divIcon({
        className: styles.trackerMarkerIcon,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        html: `
            <div class="${styles.trackerMarkerInner} ${styles.pulsing}">
                <img class="${styles.trackerMarkerImage}" src="${trackerIconUrl}" alt="" />
            </div>
        `,
    });

    return L.marker(latLng, {
        icon,
        pane,
        keyboard: false,
        interactive: false,
        zIndexOffset: 900,
    });
};

const setTrackerBearing = (marker: L.Marker, angleDeg: number): void => {
    marker.getElement()?.style.setProperty('--tracker-bearing', `${angleDeg}deg`);
};

const stopTrackerPulse = (marker: L.Marker): void => {
    marker.getElement()
        ?.querySelector(`.${styles.pulsing}`)
        ?.classList.remove(styles.pulsing);
};

const calculateTrackerBearing = (map: L.Map, from: L.LatLng, to: L.LatLng): number | null => {
    const fromPoint = map.latLngToLayerPoint(from);
    const toPoint = map.latLngToLayerPoint(to);
    const dx = toPoint.x - fromPoint.x;
    const dy = toPoint.y - fromPoint.y;
    if ((dx * dx + dy * dy) < 0.25) return null;

    return Math.atan2(dy, dx) * (180 / Math.PI) + 90;
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
    const current = readEFTrackerConf();
    if (current) {
        saveEFTrackerConf({
            ...current,
            enabled: false,
            locatorSync: false,
        });
    }

    clearEndfieldSession();
    useUiPrefsStore.getState().setPrefsLocatorSyncEnabled(false);
    useLocatorStore.getState().setViewMode('off');
    useLocatorStore.getState().setLastPosition(null);
};

const shouldDisableLocatorOnTabBoot = (): boolean => {
    const alreadyBooted = sessionStorage.getItem(ENDFIELD_LOCATOR_TAB_KEY);
    sessionStorage.setItem(ENDFIELD_LOCATOR_TAB_KEY, '1');
    void alreadyBooted;
    return false;
};

export function useEndfieldMapTracker(map: L.Map | undefined): void {
    const [configVersion, setConfigVersion] = useState(0);
    const trackerRef = useRef<MapTracker | null>(null);
    const trackerLayerRef = useRef<L.LayerGroup | null>(null);
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

        const ensureTrackerLayerAttached = () => {
            const layer = trackerLayerRef.current;
            if (!layer) return;
            if (!map.hasLayer(layer)) {
                layer.addTo(map);
            }
        };

        const onRegionSwitched = () => {
            ensureTrackerLayerAttached();
        };

        const markDetachedByUserViewChange = () => {
            if (!trackerRef.current?.isRunning()) return;
            useLocatorStore.getState().setViewMode('detached');
        };

        const returnToCurrentPosition = () => {
            const lastPosition = useLocatorStore.getState().lastPosition;
            if (!lastPosition) return;
            map.panTo(L.latLng(lastPosition.lat, lastPosition.lng), { animate: true, duration: 0.45 });
            useLocatorStore.getState().setViewMode('tracking');
        };

        const setTargetPosition = (target: L.LatLng) => {
            const marker = markerRef.current;
            if (!marker) return;

            const state = animationRef.current;
            const current = marker.getLatLng();
            const bearing = calculateTrackerBearing(map, current, target);
            if (bearing !== null) {
                setTrackerBearing(marker, bearing);
                stopTrackerPulse(marker);
            }

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
            if (!config) {
                useLocatorStore.getState().setViewMode('off');
                return;
            }

            if (shouldDisableLocatorOnTabBoot()) {
                disableLocatorSync();
                return;
            }

            if (!hasEndfieldSessionCookies()) {
                disableLocatorSync();
                return;
            }

            const pane = ensureTrackerPane(map);
            const trackerLayer = L.layerGroup();
            trackerLayer.addTo(map);
            trackerLayerRef.current = trackerLayer;

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

            const applyPositionUpdate = (payload: PositionResponse['data']) => {
                if (payload.isOnline === false) return;

                ensureTrackerLayerAttached();
                const converted = convertGamePosition(payload);
                let marker = markerRef.current;

                if (!marker) {
                    marker = createTrackerMarker(pane, converted.latLng).addTo(trackerLayer);
                    markerRef.current = marker;
                }

                const mappedRegion = resolveRegionKeyFromPayload(payload);
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

                useLocatorStore.getState().setLastPosition({
                    lat: converted.latLng.lat,
                    lng: converted.latLng.lng,
                });

                if (!hasCenteredOnFirstUpdateRef.current) {
                    hasCenteredOnFirstUpdateRef.current = true;
                    marker.setLatLng(converted.latLng);
                    map.panTo(converted.latLng, { animate: true, duration: 0.45 });
                    return;
                }

                setTargetPosition(converted.latLng);
            };

            map.on('talos:regionSwitched', onRegionSwitched);
            map.on('dragstart', markDetachedByUserViewChange);
            map.on('zoomstart', markDetachedByUserViewChange);
            window.addEventListener(LOCATOR_RETURN_CURRENT_EVENT, returnToCurrentPosition);

            void tracker.fetchCurrentPosition()
                .then((payload) => {
                    if (disposed) return;
                    applyPositionUpdate(payload);
                    tracker.subscribe(applyPositionUpdate);
                    tracker.start();
                    useLocatorStore.getState().setViewMode('tracking');
                })
                .catch(() => {
                    if (!disposed) disableLocatorSync();
                });
        };

        boot();

        return () => {
            disposed = true;
            cleanupAnimation();
            trackerRef.current?.destroy();
            trackerRef.current = null;

            map.off('talos:regionSwitched', onRegionSwitched);
            map.off('dragstart', markDetachedByUserViewChange);
            map.off('zoomstart', markDetachedByUserViewChange);
            window.removeEventListener(LOCATOR_RETURN_CURRENT_EVENT, returnToCurrentPosition);

            if (markerRef.current) {
                markerRef.current.remove();
                markerRef.current = null;
            }

            if (trackerLayerRef.current) {
                trackerLayerRef.current.remove();
                trackerLayerRef.current = null;
            }

            hasCenteredOnFirstUpdateRef.current = false;
        };
    }, [map, configVersion]);
}
