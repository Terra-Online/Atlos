import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import type { AnyLabel } from '@/data/map/label/types';
import { useTranslate, useLocale } from '@/locale';
import { mapRegionKeyToLocaleCode } from '@/data/map/label/placeIndex';
import styles from './Label.module.scss';
import { selectLabelMapForRegion, useLabelStore } from '@/store/label';
import { useTriggerlabelName } from '@/store/uiPrefs';

const escapeHtml = (s: string): string =>
    s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const ensurePane = (map: L.Map): string => {
    const paneName = 'labels';
    const existing = map.getPane(paneName);
    if (existing) return paneName;
    const pane = map.createPane(paneName);
    pane.style.zIndex = '650';
    pane.style.pointerEvents = 'none';
    return paneName;
};

const ZOOM_THRESHOLD = 0.25;

type RegionStructure =
    | { kind: 'nested' }
    | { kind: 'flat' };

const detectRegionStructure = (t: <T = string>(key: string) => T, regionCode: string): RegionStructure => {
    // Heuristic: flat regions use structure like game.region.DJ.sub = { name, site: {..} }
    // nested regions use game.region.VL.sub.<subKey> = { short, name, site: {..} }
    const subNode = t<unknown>(`game.region.${regionCode}.sub`);
    if (isObject(subNode) && isObject(subNode.site) && typeof subNode.name === 'string') {
        return { kind: 'flat' };
    }
    return { kind: 'nested' };
};

const resolveLabelText = (t: <T = string>(key: string) => T, regionCode: string, structure: RegionStructure, label: AnyLabel): string => {
    if (structure.kind === 'flat') {
        if (label.type === 'sub') {
            return t<string>(`game.region.${regionCode}.sub.name`) || regionCode;
        }
        return t<string>(`game.region.${regionCode}.sub.site.${label.site}`) || label.site;
    }

    // `label.sub` is the stable sub-region key (e.g. PL/WL/JY), which is also the key
    // used in all locale JSON. Do NOT use localized `short` for label lookup.
    const subKey = label.sub;

    if (label.type === 'sub') {
        return t<string>(`game.region.${regionCode}.sub.${subKey}.name`) || label.sub;
    }

    return t<string>(`game.region.${regionCode}.sub.${subKey}.site.${label.site}`) || label.site;
};

const renderLabels = (
    map: L.Map,
    pane: string,
    layer: L.LayerGroup,
    labels: AnyLabel[],
    zoom: number,
    maxZoom: number,
    t: <T = string>(key: string) => T,
    regionCode: string,
    structure: RegionStructure,
    currentType: AnyLabel['type'] | null,
) => {
    const showType: AnyLabel['type'] = structure.kind === 'flat' ? 'site' : (zoom <= ZOOM_THRESHOLD ? 'sub' : 'site');
    
    // 只在标签类型切换时才重新渲染
    if (currentType === showType) {
        return showType;
    }

    // 淡出旧标签
    if (currentType !== null && layer.getLayers().length > 0) {
        layer.eachLayer((marker) => {
            const element = (marker as L.Marker).getElement();
            if (element) {
                element.style.animation = 'fadeOut 0.2s ease-in-out';
            }
        });
        // 等待淡出动画完成后清除
        setTimeout(() => {
            layer.clearLayers();
            addNewLabels();
        }, 200);
    } else {
        layer.clearLayers();
        addNewLabels();
    }

    function addNewLabels() {
        for (const label of labels) {
            if (label.type !== showType) continue;

            const [x, y] = label.point;
            const latLng = map.unproject([x, y], maxZoom);
            const text = resolveLabelText(t, regionCode, structure, label);

            const marker = L.marker(latLng, {
                pane,
                interactive: false,
                icon: L.divIcon({
                    className: styles.label,
                    html: `<div class="${label.type === 'site' ? styles.innerSite : styles.innerSub}">${escapeHtml(text)}</div>`,
                    iconSize: [0, 0],
                }),
            });
            layer.addLayer(marker);
        }
    }

    return showType;
};

export const useLabel = (map: L.Map | null, mapRegionKey: string | null | undefined, maxZoom: number | null | undefined) => {
    const t = useTranslate();
    // Force effects/memos to react to locale changes even if `t` is referentially stable.
    const locale = useLocale();

    const showRegionLabels = useTriggerlabelName();

    const regionCode = useMemo(() => mapRegionKeyToLocaleCode(mapRegionKey), [mapRegionKey]);
    const structure = useMemo(() => {
        // Intentionally reference `locale` so memo recomputes on language switch.
        void locale;
        return regionCode ? detectRegionStructure(t, regionCode) : null;
    }, [t, regionCode, locale]);

    const labelMap = useLabelStore(useMemo(() => (regionCode ? selectLabelMapForRegion(regionCode) : () => undefined), [regionCode]));
    const labels = useMemo(() => (labelMap ? Object.values(labelMap) : []), [labelMap]);

    const layerRef = useRef<L.LayerGroup | null>(null);
    const paneRef = useRef<string | null>(null);
    const currentLabelTypeRef = useRef<AnyLabel['type'] | null>(null);

    useEffect(() => {
        // Intentionally reference `locale` so the effect re-runs on language switch
        // and re-renders labels immediately (without requiring a zoom event).
        void locale;
        if (!map || !regionCode || typeof maxZoom !== 'number' || !structure) return;

        // Reset current label type to force re-render when dependencies change (e.g. locale, labels)
        currentLabelTypeRef.current = null;

        const isLabelToolMounted = (): boolean => {
            if (!import.meta.env.DEV) return false;
            if (typeof document === 'undefined') return false;
            return Boolean(document.getElementById('talos-label-tool-root'));
        };

        // If the dev label tool is active, it will render draggable labels itself.
        // Avoid rendering the main label layer at the same time to prevent duplicates.
        if (isLabelToolMounted()) {
            if (layerRef.current && map.hasLayer(layerRef.current)) {
                layerRef.current.remove();
            }
            return;
        }

        if (!showRegionLabels) {
            if (layerRef.current && map.hasLayer(layerRef.current)) {
                layerRef.current.remove();
            }
            return;
        }

        const pane = ensurePane(map);
        paneRef.current = pane;

        if (!layerRef.current) {
            layerRef.current = L.layerGroup([], { pane });
        }
        if (!map.hasLayer(layerRef.current)) {
            layerRef.current.addTo(map);
        }

        const layer = layerRef.current;

        const doRender = () => {
            if (isLabelToolMounted()) {
                if (map.hasLayer(layer)) {
                    layer.remove();
                }
                return;
            }

            if (!showRegionLabels) {
                if (map.hasLayer(layer)) {
                    layer.remove();
                }
                return;
            }
            const z = map.getZoom();
            const newType = renderLabels(map, pane, layer, labels, z, maxZoom, t, regionCode, structure, currentLabelTypeRef.current);
            currentLabelTypeRef.current = newType;
        };

        const onToolMounted = () => {
            if (map.hasLayer(layer)) {
                layer.remove();
            }
        };

        const onRegionSwitched = () => {
            if (isLabelToolMounted()) {
                if (map.hasLayer(layer)) {
                    layer.remove();
                }
                return;
            }

            if (!showRegionLabels) {
                if (map.hasLayer(layer)) {
                    layer.remove();
                }
                return;
            }
            // Reset current label type to force re-render
            currentLabelTypeRef.current = null;
            if (!map.hasLayer(layer)) {
                layer.addTo(map);
            }
            doRender();
        };

        doRender();
        map.on('zoomend', doRender);
        map.on('talos:regionSwitched', onRegionSwitched);
        map.on('talos:labelToolMounted', onToolMounted);

        return () => {
            map.off('zoomend', doRender);
            map.off('talos:regionSwitched', onRegionSwitched);
            map.off('talos:labelToolMounted', onToolMounted);
        };
    }, [map, regionCode, maxZoom, t, labels, structure, showRegionLabels, locale]);

    // Cleanup if map is destroyed
    useEffect(() => {
        if (!map) return;
        return () => {
            if (layerRef.current) {
                layerRef.current.remove();
                layerRef.current = null;
            }
        };
    }, [map]);
};
