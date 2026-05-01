import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import useRegion from '@/store/region';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { REGION_DICT } from '@/data/map';
import trackerIconUrl from '@/assets/images/UI/icon_char.png';
import { LOCATOR_RETURN_CURRENT_EVENT, useLocatorStore } from '@/component/locator/state';
import {
    EFBackendError,
    getEFPosition,
    openEFPositionSocket,
    unlinkEFBinding,
    type EFPositionSocketMessage,
} from '@/utils/endfield/backendClient';
import type { PositionResponse } from '@/utils/endfield/types';
import { convertEFPosition, type EFLocatorPosition } from '@/utils/endfield/locatorTransform';
import {
    LOCATOR_CONFIG_UPDATED_EVENT,
    readEFTrackerConf,
    saveEFTrackerConf,
} from '@/utils/endfield/config';
import styles from './Locator.module.scss';

type TrackerConfig = {
    enabled: boolean;
    baseUrl: string;
    roleId: string;
    serverId: number;
    locatorSync: boolean;
    intervalMs?: number;
    debug?: boolean;
};

const LOCATOR_PANE = 'talos-endfield-tracker-pane';
const LOCATOR_LAYER_Z_INDEX = 640;

const ensureTrackerPane = (map: L.Map): string => {
    const existing = map.getPane(LOCATOR_PANE);
    if (existing) return LOCATOR_PANE;
    const pane = map.createPane(LOCATOR_PANE);
    pane.style.zIndex = String(LOCATOR_LAYER_Z_INDEX);
    pane.style.pointerEvents = 'none';
    return LOCATOR_PANE;
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

const getPositionSceneKey = (payload: PositionResponse['data']): string =>
    `${payload.mapId.trim().toLowerCase()}\n${payload.levelId.trim().toLowerCase()}`;

const DEFAULT_LOCATOR_INTERVAL_MS = 1000;
const LOCATOR_TARGET_ZOOM = 3;
const LOCATOR_FOLLOW_CENTER_RATIO = 0.25;
const POSITION_UNAVAILABLE_RETRY_MS = 5000;

type UpKind = 'expired' | 'notInGame' | 'policy';

const UP_KIND: Partial<Record<number, UpKind>> = {
    10000: 'expired',
    19001: 'notInGame',
    19002: 'policy',
};

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

const errInfo = (error: EFBackendError): {
    upstreamCode?: unknown;
    upstreamMessage?: unknown;
} | undefined => {
    const details = error.details as {
        upstreamCode?: unknown;
        upstreamMessage?: unknown;
    } | undefined;
    return details;
};

const errCode = (error: EFBackendError): number | null => {
    const details = errInfo(error);
    const code = Number(details?.upstreamCode);
    return Number.isFinite(code) ? code : null;
};

const errKind = (error: EFBackendError): UpKind | null => {
    const code = errCode(error);
    return code === null ? null : UP_KIND[code] ?? null;
};

const showErr = (error: EFBackendError): void => {
    const code = errCode(error);
    if (code === null) return;

    if (UP_KIND[code]) {
        useLocatorStore.getState().showBanner(`locator.errors.${code}`);
    }
};

export function useLocator(map: L.Map | undefined): void {
    const [configVersion, setConfigVersion] = useState(0);
    const trackerRunningRef = useRef(false);
    const pollTimerRef = useRef<number | null>(null);
    const socketRef = useRef<WebSocket | null>(null);
    const trackerLayerRef = useRef<L.LayerGroup | null>(null);
    const markerRef = useRef<L.Marker | null>(null);
    const lastSyncedRegionRef = useRef<string | null>(null);
    const lastSyncedSubregionRef = useRef<string | null>(null);
    const lastSceneKeyRef = useRef<string | null>(null);
    const pendingLocatorFocusRef = useRef<L.LatLng | null>(null);
    const currentLocatorRegionRef = useRef<string | null>(null);
    const programmaticViewChangeRef = useRef(false);
    const programmaticViewTimeoutRef = useRef<number | null>(null);
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

        window.addEventListener(LOCATOR_CONFIG_UPDATED_EVENT, onConfigUpdated as EventListener);
        return () => {
            window.removeEventListener(LOCATOR_CONFIG_UPDATED_EVENT, onConfigUpdated as EventListener);
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
            if (socketRef.current) {
                socketRef.current.close(1000, 'locator stopped');
                socketRef.current = null;
            }
        };

        const pauseForErr = (error: EFBackendError) => {
            showErr(error);
            cleanupPolling();
            useLocatorStore.getState().setViewMode('tracking');
        };

        const onExpired = (error: EFBackendError) => {
            showErr(error);
            cleanupPolling();
            void unlinkEFBinding()
                .catch(() => undefined)
                .finally(() => {
                    if (disposed) return;
                    disableLocatorSync();
                    useLocatorStore.getState().reqBind();
                });
        };

        const onPolicy = (error: EFBackendError) => {
            pauseForErr(error);
            useLocatorStore.getState().openAuth();
        };

        const onNotInGame = (error: EFBackendError) => {
            showErr(error);
            cleanupPolling();
            disableLocatorSync();
        };

        const onUpstream = (error: EFBackendError): boolean => {
            const kind = errKind(error);
            if (kind === 'expired') {
                onExpired(error);
                return true;
            }
            if (kind === 'policy') {
                onPolicy(error);
                return true;
            }
            if (kind === 'notInGame') {
                onNotInGame(error);
                return true;
            }
            return false;
        };

        const isLocatorRegionVisible = (regionKey = currentLocatorRegionRef.current): boolean => {
            if (!regionKey) return true;
            return useRegion.getState().currentRegionKey === regionKey;
        };

        const syncTrackerLayerVisibility = (regionKey = currentLocatorRegionRef.current) => {
            const layer = trackerLayerRef.current;
            if (!layer) return;
            if (isLocatorRegionVisible(regionKey)) {
                if (!map.hasLayer(layer)) {
                    layer.addTo(map);
                }
                return;
            }
            if (map.hasLayer(layer)) {
                layer.remove();
            }
        };

        const releaseProgrammaticViewChange = () => {
            programmaticViewChangeRef.current = false;
            map.off('moveend', releaseProgrammaticViewChange);
            if (programmaticViewTimeoutRef.current !== null) {
                window.clearTimeout(programmaticViewTimeoutRef.current);
                programmaticViewTimeoutRef.current = null;
            }
        };

        const focusLocatorPosition = (target: L.LatLng) => {
            releaseProgrammaticViewChange();
            programmaticViewChangeRef.current = true;
            const targetZoom = Math.min(LOCATOR_TARGET_ZOOM, map.getMaxZoom());
            map.once('moveend', releaseProgrammaticViewChange);
            programmaticViewTimeoutRef.current = window.setTimeout(releaseProgrammaticViewChange, 1500);
            map.flyTo(target, targetZoom, {
                animate: true,
                duration: 0.9,
            });
            useLocatorStore.getState().setViewMode('tracking');
        };

        const panLocatorIntoCenterBand = (target: L.LatLng) => {
            if (useLocatorStore.getState().viewMode !== 'tracking') return;
            if (!isLocatorRegionVisible()) return;

            const size = map.getSize();
            if (!size.x || !size.y) return;

            const point = map.latLngToContainerPoint(target);
            const center = size.divideBy(2);
            const dx = point.x - center.x;
            const dy = point.y - center.y;
            const limitX = size.x * LOCATOR_FOLLOW_CENTER_RATIO;
            const limitY = size.y * LOCATOR_FOLLOW_CENTER_RATIO;

            if (Math.abs(dx) <= limitX && Math.abs(dy) <= limitY) return;

            releaseProgrammaticViewChange();
            programmaticViewChangeRef.current = true;
            map.once('moveend', releaseProgrammaticViewChange);
            programmaticViewTimeoutRef.current = window.setTimeout(releaseProgrammaticViewChange, 1200);
            map.panTo(target, {
                animate: true,
                duration: 0.65,
            });
        };

        const consumePendingLocatorFocus = () => {
            const target = pendingLocatorFocusRef.current;
            if (!target) return;
            pendingLocatorFocusRef.current = null;
            focusLocatorPosition(target);
        };

        const onRegionSwitched = () => {
            syncTrackerLayerVisibility();
            lastSyncedRegionRef.current = null;
            if (isLocatorRegionVisible()) {
                consumePendingLocatorFocus();
            }
        };

        const markDetachedByUserViewChange = () => {
            if (programmaticViewChangeRef.current) return;
            if (!trackerRunningRef.current) return;
            useLocatorStore.getState().setViewMode('detached');
        };

        const returnToCurrentPosition = () => {
            const lastPosition = useLocatorStore.getState().lastPosition;
            if (!lastPosition) return;
            const target = L.latLng(lastPosition.lat, lastPosition.lng);
            const regionKey = lastPosition.regionKey;
            const subregionKey = lastPosition.subregionKey;
            currentLocatorRegionRef.current = regionKey ?? null;
            pendingLocatorFocusRef.current = target;

            if (subregionKey) {
                useRegion.getState().requestSubregionSwitch(subregionKey);
                return;
            }

            if (regionKey && REGION_DICT[regionKey] && regionKey !== useRegion.getState().currentRegionKey) {
                useRegion.getState().setCurrentRegion(regionKey);
                return;
            }

            pendingLocatorFocusRef.current = null;
            syncTrackerLayerVisibility(regionKey ?? null);
            focusLocatorPosition(target);
        };

        const onSubregionSwitched = () => {
            consumePendingLocatorFocus();
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

            const pane = ensureTrackerPane(map);
            const trackerLayer = L.layerGroup();
            trackerLayer.addTo(map);
            trackerLayerRef.current = trackerLayer;

            if (disposed) return;

            const applyPositionUpdate = (payload: PositionResponse['data']) => {
                if (payload.isOnline === false) return;

                useLocatorStore.getState().clearBanner();
                const locator = convertEFPosition(payload);
                const converted = convertGamePosition(locator);
                currentLocatorRegionRef.current = locator.regionKey;
                syncTrackerLayerVisibility(locator.regionKey);
                let marker = markerRef.current;
                let shouldDeferFocus = false;
                const sceneKey = getPositionSceneKey(payload);
                const isFirstScene = lastSceneKeyRef.current === null;
                const sceneChanged = isFirstScene || sceneKey !== lastSceneKeyRef.current;

                if (!marker) {
                    marker = createTrackerMarker(pane, converted.latLng).addTo(trackerLayer);
                    markerRef.current = marker;
                }

                const mappedRegion = locator.regionKey;
                const shouldFocusScene = Boolean(config.locatorSync
                    && sceneChanged
                    && mappedRegion
                    && REGION_DICT[mappedRegion]);

                if (config.locatorSync && sceneChanged && mappedRegion && REGION_DICT[mappedRegion]) {
                    const store = useRegion.getState();
                    const targetRegion = mappedRegion;
                    if (
                        targetRegion !== store.currentRegionKey
                        && targetRegion !== lastSyncedRegionRef.current
                    ) {
                        pendingLocatorFocusRef.current = converted.latLng;
                        marker.setLatLng(converted.latLng);
                        store.setCurrentRegion(targetRegion);
                        lastSyncedRegionRef.current = targetRegion;
                        shouldDeferFocus = true;
                    }
                }

                if (
                    config.locatorSync
                    && sceneChanged
                    && locator.subregionKey
                    && locator.subregionKey !== lastSyncedSubregionRef.current
                ) {
                    pendingLocatorFocusRef.current = converted.latLng;
                    useRegion.getState().requestSubregionSwitch(locator.subregionKey);
                    lastSyncedSubregionRef.current = locator.subregionKey;
                    shouldDeferFocus = true;
                }

                useLocatorStore.getState().setLastPosition({
                    lat: converted.latLng.lat,
                    lng: converted.latLng.lng,
                    gameX: payload.pos.x,
                    gameY: payload.pos.y,
                    gameZ: payload.pos.z,
                    locatorProfile: locator.mode,
                    regionKey: locator.regionKey,
                    subregionKey: locator.subregionKey,
                });

                lastSceneKeyRef.current = sceneKey;

                if (shouldDeferFocus) {
                    marker.setLatLng(converted.latLng);
                    hasCenteredOnFirstUpdateRef.current = true;
                    return;
                }

                if (shouldFocusScene) {
                    hasCenteredOnFirstUpdateRef.current = true;
                    marker.setLatLng(converted.latLng);
                    focusLocatorPosition(converted.latLng);
                    return;
                }

                if (!hasCenteredOnFirstUpdateRef.current) {
                    hasCenteredOnFirstUpdateRef.current = true;
                    marker.setLatLng(converted.latLng);
                    return;
                }

                setTargetPosition(converted.latLng);
                panLocatorIntoCenterBand(converted.latLng);
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
                    if (response.data.isOnline === false) {
                        scheduleNextPoll((config.intervalMs ?? DEFAULT_LOCATOR_INTERVAL_MS) * 3);
                        return;
                    }
                    startPositionSocket();
                    if (!socketRef.current) {
                        scheduleNextPoll(config.intervalMs ?? DEFAULT_LOCATOR_INTERVAL_MS);
                    }
                } catch (error) {
                    if (disposed) return;
                    if (!(error instanceof EFBackendError)) {
                        disableLocatorSync();
                        return;
                    }
                    if (onUpstream(error)) {
                        return;
                    }
                    if (error.code !== 'ENDFIELD_POSITION_UNAVAILABLE') {
                        disableLocatorSync();
                        return;
                    }
                    scheduleNextPoll(POSITION_UNAVAILABLE_RETRY_MS);
                }
            };

            const startPositionSocket = () => {
                if (disposed || !trackerRunningRef.current || socketRef.current) return;
                if (typeof WebSocket === 'undefined') {
                    scheduleNextPoll(config.intervalMs ?? DEFAULT_LOCATOR_INTERVAL_MS);
                    return;
                }

                let sawPosition = false;
                const socket = openEFPositionSocket();
                socketRef.current = socket;

                socket.addEventListener('message', (event) => {
                    if (disposed) return;
                    try {
                        const message = JSON.parse(String(event.data)) as EFPositionSocketMessage;
                        if (message.type === 'position') {
                            sawPosition = true;
                            applyPositionUpdate(message.data);
                            return;
                        }

                        if (message.type === 'error') {
                            const error = new EFBackendError(message.error.message || message.error.code || 'Locator stream error.', {
                                status: message.error.status ?? 500,
                                code: message.error.code ?? 'LOCATOR_STREAM_ERROR',
                                details: message.error.details,
                            });
                            if (onUpstream(error)) {
                                socket.close(1000, 'locator upstream state changed');
                            }
                        }
                    } catch {
                        // Ignore malformed stream frames; the next valid frame will recover state.
                    }
                });

                socket.addEventListener('close', () => {
                    if (socketRef.current === socket) {
                        socketRef.current = null;
                    }
                    if (disposed || !trackerRunningRef.current) return;
                    scheduleNextPoll(sawPosition ? (config.intervalMs ?? DEFAULT_LOCATOR_INTERVAL_MS) : 250);
                });

                socket.addEventListener('error', () => {
                    socket.close();
                });
            };

            map.on('talos:regionSwitched', onRegionSwitched);
            map.on('talos:subregionSwitched', onSubregionSwitched);
            map.on('dragstart', markDetachedByUserViewChange);
            map.on('zoomstart', markDetachedByUserViewChange);
            window.addEventListener(LOCATOR_RETURN_CURRENT_EVENT, returnToCurrentPosition);

            trackerRunningRef.current = true;
            void getEFPosition({ includeBinding: true })
                .then((response) => {
                    if (disposed) return;
                    applyPositionUpdate(response.data);
                    useLocatorStore.getState().setViewMode('tracking');
                    startPositionSocket();
                })
                .catch((error: unknown) => {
                    if (disposed) return;
                    if (error instanceof EFBackendError) {
                        if (onUpstream(error)) {
                            return;
                        }
                        if (error.code !== 'ENDFIELD_POSITION_UNAVAILABLE') {
                            disableLocatorSync();
                            return;
                        }
                        useLocatorStore.getState().setViewMode('tracking');
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
            map.off('talos:subregionSwitched', onSubregionSwitched);
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
            lastSceneKeyRef.current = null;
            pendingLocatorFocusRef.current = null;
            currentLocatorRegionRef.current = null;
            programmaticViewChangeRef.current = false;
            if (programmaticViewTimeoutRef.current !== null) {
                window.clearTimeout(programmaticViewTimeoutRef.current);
                programmaticViewTimeoutRef.current = null;
            }
        };
    }, [map, configVersion]);
}
