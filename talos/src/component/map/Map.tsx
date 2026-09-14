import React, { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import styles from './Map.module.scss';
import { useMap } from './useMap';
import L from 'leaflet';
import { useLabel } from './useLabel';
import { useLink } from './useLink';
import { UsePreview } from './usePreview';
import { DEFAULT_REGION, REGION_DICT } from '@/data/map';
import { isMapOverdragged, toMapBounds } from './mapOverdrag';
import { useBehaviorOverlay } from './behaviorOverlay/useBehaviorOverlay';

interface MapProps {
    onMapReady?: (mapInstance: L.Map) => void;
}

const Map: React.FC<MapProps> = ({ onMapReady }) => {
    const mapElementRef = useRef<HTMLDivElement>(null);
    const { map, currentRegion } = useMap(mapElementRef.current);
    const [isOverdrag, setIsOverdrag] = useState(false);

    const isOverdragRef = useRef(false);
    const rafIdRef = useRef<number | null>(null);

    useEffect(() => {
        if (map && onMapReady) {
            onMapReady(map);
        }
    }, [map, onMapReady]);

    const maxZoom =
        (currentRegion ? REGION_DICT[currentRegion]?.maxZoom : undefined) ??
        REGION_DICT[DEFAULT_REGION].maxZoom;
    useLabel(map, currentRegion, maxZoom);
    const { linkTooltipElement } = useLink(map, currentRegion, maxZoom);
    const { PreviewElement } = UsePreview(map);
    useBehaviorOverlay(map);

    useEffect(() => {
        if (!map) return;

        const setOverdrag = (over: boolean) => {
            if (over === isOverdragRef.current) return;
            isOverdragRef.current = over;
            setIsOverdrag(over);
        };

        const update = () => {
            rafIdRef.current = null;
            const max = toMapBounds(map.options.maxBounds);
            setOverdrag(max ? isMapOverdragged(map, max) : false);
        };

        const onDrag = () => {
            if (rafIdRef.current !== null) return;
            rafIdRef.current = requestAnimationFrame(update);
        };

        const clear = () => {
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }
            setOverdrag(false);
        };

        map.on('drag', onDrag);
        map.on('move', onDrag);
        map.on('dragend', clear);
        map.on('zoomstart', clear);
        map.on('movestart', clear);
        map.on('moveend', clear);

        return () => {
            map.off('drag', onDrag);
            map.off('move', onDrag);
            map.off('dragend', clear);
            map.off('zoomstart', clear);
            map.off('movestart', clear);
            map.off('moveend', clear);
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }
        };
    }, [map]);

    return (
        <>
            <div
                ref={mapElementRef}
                className={`${styles.mapContainer} ${isOverdrag ? styles.overdrag : ''}`}
                id='map'
            ></div>
            {linkTooltipElement}
            {PreviewElement}
        </>
    );
};

export default Map;
