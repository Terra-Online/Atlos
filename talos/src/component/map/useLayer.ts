import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import type { AnyLabel } from '@/data/map/label/types';
import { useTranslate, useLocale } from '@/locale';
import { mapRegionKeyToLocaleCode } from '@/data/map/label/placeIndex';
import styles from './LabelLayer.module.scss';
import { selectLabelMapForRegion, useLabelStore } from '@/store/label';

const escapeHtml = (s: string): string =>
    s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const ensurePane = (map: L.Map): string => {
    const paneName = 'talos-labels';
    const existing = map.getPane(paneName);
    if (existing) return paneName;
    const pane = map.createPane(paneName);
    pane.style.zIndex = '650';
    pane.style.pointerEvents = 'none';
    return paneName;
};

const ZOOM_THRESHOLD = 0.5;

type ShortToSubKey = Record<string, string>;

const useShortToSubKey = (regionCode: string | null): ShortToSubKey => {
    const t = useTranslate();
    // re-run when locale changes
    useLocale();

    return useMemo(() => {
        if (!regionCode) return {};
        const regionBundle = t<unknown>('game.region');
        if (!isObject(regionBundle)) return {};
        const regionNode = regionBundle[regionCode];
        if (!isObject(regionNode)) return {};
        const subNode = regionNode.sub;
        if (!isObject(subNode)) return {};

        const map: ShortToSubKey = {};
        for (const subKey of Object.keys(subNode)) {
            const sub = subNode[subKey];
            if (!isObject(sub)) continue;
            const short = sub.short;
            if (typeof short === 'string') {
                map[short] = subKey;
            }
        }
        return map;
    }, [regionCode, t]);
};

const resolveLabelText = (t: <T = string>(key: string) => T, regionCode: string, shortToSubKey: ShortToSubKey, label: AnyLabel): string => {
    const subKey = shortToSubKey[label.sub];
    if (!subKey) return label.type === 'site' ? label.site : label.sub;

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
    shortToSubKey: ShortToSubKey,
) => {
    layer.clearLayers();

    const showType: AnyLabel['type'] = zoom <= ZOOM_THRESHOLD ? 'sub' : 'site';

    for (const label of labels) {
        if (label.type !== showType) continue;

        const [x, y] = label.point;
        const latLng = map.unproject([x, y], maxZoom);
        const text = resolveLabelText(t, regionCode, shortToSubKey, label);

        const marker = L.marker(latLng, {
            pane,
            interactive: false,
            icon: L.divIcon({
                className: styles.label,
                html: `<div class="${styles.inner}">${escapeHtml(text)}</div>`,
                iconSize: [0, 0],
            }),
        });
        layer.addLayer(marker);
    }
};

export const useLabelLayer = (map: L.Map | null, mapRegionKey: string | null | undefined, maxZoom: number | null | undefined) => {
    const t = useTranslate();
    const locale = useLocale();

    const regionCode = useMemo(() => mapRegionKeyToLocaleCode(mapRegionKey), [mapRegionKey]);
    const shortToSubKey = useShortToSubKey(regionCode);

    const labelMap = useLabelStore(useMemo(() => (regionCode ? selectLabelMapForRegion(regionCode) : () => undefined), [regionCode]));
    const labels = useMemo(() => (labelMap ? Object.values(labelMap) : []), [labelMap]);

    const layerRef = useRef<L.LayerGroup | null>(null);
    const paneRef = useRef<string | null>(null);

    useEffect(() => {
        if (!map || !regionCode || typeof maxZoom !== 'number') return;

        const pane = ensurePane(map);
        paneRef.current = pane;

        if (!layerRef.current) {
            layerRef.current = L.layerGroup([], { pane });
            layerRef.current.addTo(map);
        }

        const layer = layerRef.current;

        const doRender = () => {
            const z = map.getZoom();
            renderLabels(map, pane, layer, labels, z, maxZoom, t, regionCode, shortToSubKey);
        };

        doRender();
        map.on('zoomend', doRender);

        return () => {
            map.off('zoomend', doRender);
        };
    }, [map, regionCode, maxZoom, t, locale, shortToSubKey, labels]);

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
