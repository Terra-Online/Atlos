import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import useRegion from '@/store/region';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { REGION_DICT } from '@/data/map';
import trackerIconUrl from '@/assets/images/UI/icon_char.png';
import { LOCATOR_RETURN_CURRENT_EVENT, useLocatorStore } from '@/component/locator/state';
import { EFBackendError, getEFPosition } from '@/utils/endfield/backendClient';
import type { PositionResponse } from '@/utils/endfield/types';
import { convertEFPosition, type EFLocatorPosition } from '@/utils/endfield/locatorTransform';
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
    locator: EFLocatorPosition,
): { latLng: L.LatLng; mapX: number; mapZ: number; mode: string } => {
    return {
        latLng: L.latLng(locator.mapZ, locator.mapX),
        mapX: locator.mapX,
        mapZ: locator.mapZ,
        mode: locator.mode,
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
const POSITION_UNAVAILABLE_RETRY_MS = 5000;
const POSITION_UPSTREAM_NOT_IN_GAME_CODE = 19001;

const disableLocatorSync = (): void => {
    const current = readEFTrackerConf();
    if (current) {
        saveEFTrackerConf({
            ...current,
            enabled: false,
            locatorSync: false,
        });
    }

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

const getPositionErrorDetails = (error: EFBackendError): {
    upstreamCode?: unknown;
    upstreamMessage?: unknown;
} | undefined => {
    const details = error.details as {
        upstreamCode?: unknown;
        upstreamMessage?: unknown;
    } | undefined;
    return details;
};

const isPositionNotInGameError = (error: EFBackendError): boolean => {
    const details = getPositionErrorDetails(error);
    return Number(details?.upstreamCode) === POSITION_UPSTREAM_NOT_IN_GAME_CODE;
};

const showPositionUnavailableBanner = (error: EFBackendError): void => {
    const details = getPositionErrorDetails(error);
    if (!isPositionNotInGameError(error)) return;
    if (typeof details?.upstreamMessage !== 'string' || !details.upstreamMessage.trim()) return;

    useLocatorStore.getState().showBanner(details.upstreamMessage.trim());
};

export function useEndfieldMapTracker(map: L.Map | undefined): void {
    const [configVersion, setConfigVersion] = useState(0);
    const trackerRunningRef = useRef(false);
    const pollTimerRef = useRef<number | null>(null);
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

        const cleanupPolling = () => {
            trackerRunningRef.current = false;
            if (pollTimerRef.current !== null) {
                window.clearTimeout(pollTimerRef.current);
                pollTimerRef.current = null;
            }
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
            if (!trackerRunningRef.current) return;
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

            const pane = ensureTrackerPane(map);
            const trackerLayer = L.layerGroup();
            trackerLayer.addTo(map);
            trackerLayerRef.current = trackerLayer;

            if (disposed) return;

            const applyPositionUpdate = (payload: PositionResponse['data']) => {
                if (payload.isOnline === false) return;

                useLocatorStore.getState().clearBanner();
                ensureTrackerLayerAttached();
                const locator = convertEFPosition(payload);
                if (!locator) {
                    throw new Error('Endfield locator transform is not configured.');
                }
                const converted = convertGamePosition(locator);
                let marker = markerRef.current;

                if (!marker) {
                    marker = createTrackerMarker(pane, converted.latLng).addTo(trackerLayer);
                    markerRef.current = marker;
                }

                const mappedRegion = locator.regionKey;
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

            const scheduleNextPoll = (delayMs: number) => {
                if (!trackerRunningRef.current || disposed) return;
                if (pollTimerRef.current !== null) {
                    window.clearTimeout(pollTimerRef.current);
                }
                pollTimerRef.current = window.setTimeout(() => {
                    void pollOnce();
                }, delayMs);
            };

            const pollOnce = async () => {
                if (!trackerRunningRef.current || disposed) return;

                try {
                    const response = await getEFPosition();
                    applyPositionUpdate(response.data);
                    scheduleNextPoll(response.data.isOnline === false ? (config.intervalMs ?? 1500) * 3 : (config.intervalMs ?? 1500));
                } catch (error) {
                    if (disposed) return;
                    if (!(error instanceof EFBackendError) || (!isPositionNotInGameError(error) && error.code !== 'ENDFIELD_POSITION_UNAVAILABLE')) {
                        disableLocatorSync();
                        return;
                    }
                    showPositionUnavailableBanner(error);
                    scheduleNextPoll(POSITION_UNAVAILABLE_RETRY_MS);
                }
            };

            map.on('talos:regionSwitched', onRegionSwitched);
            map.on('dragstart', markDetachedByUserViewChange);
            map.on('zoomstart', markDetachedByUserViewChange);
            window.addEventListener(LOCATOR_RETURN_CURRENT_EVENT, returnToCurrentPosition);

            trackerRunningRef.current = true;
            void getEFPosition()
                .then((response) => {
                    if (disposed) return;
                    applyPositionUpdate(response.data);
                    useLocatorStore.getState().setViewMode('tracking');
                    scheduleNextPoll(config.intervalMs ?? 1500);
                })
                .catch((error: unknown) => {
                    if (disposed) return;
                    if (error instanceof EFBackendError && (isPositionNotInGameError(error) || error.code === 'ENDFIELD_POSITION_UNAVAILABLE')) {
                        useLocatorStore.getState().setViewMode('tracking');
                        showPositionUnavailableBanner(error);
                        scheduleNextPoll(POSITION_UNAVAILABLE_RETRY_MS);
                        return;
                    }
                    disableLocatorSync();
                });
        };

        boot();

        return () => {
            disposed = true;
            cleanupAnimation();
            cleanupPolling();

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
