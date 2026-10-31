import React, { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import styles from '@/pages/map/Map.module.scss';
import { useMap } from '@/pages/map/useMap';
import L from 'leaflet';
import { useLabel } from '@/pages/map/useLabel';
import { useLink } from '@/pages/map/useLink';
import { UsePreview } from '@/pages/map/usePreview';
import { DEFAULT_REGION, REGION_DICT } from '@/data/map';
import { isMapOverdragged } from '@/services/map/core/mapOverdrag';
import { useBehaviorOverlay } from '@/pages/map/behaviorOverlay/useBehaviorOverlay';
import MapContextMenu from '@/pages/map/MapContextMenu';
import SupplementTooltip from '@/pages/map/behaviorOverlay/SupplementTooltip';
import { useMapSupplements } from '@/pages/map/behaviorOverlay/useMapSupplements';

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

    const coordZoom =
        (currentRegion ? REGION_DICT[currentRegion]?.coordZoom : undefined) ??
        REGION_DICT[DEFAULT_REGION].coordZoom;
    useLabel(map, currentRegion, coordZoom);
    const { linkTooltipElement } = useLink(map, currentRegion, coordZoom);
    const { PreviewElement } = UsePreview(map);
    useBehaviorOverlay(map);
    const supplementHover = useMapSupplements(map);

    useEffect(() => {
        if (!map) return;

        const setOverdrag = (over: boolean) => {
            if (over === isOverdragRef.current) return;
            isOverdragRef.current = over;
            setIsOverdrag(over);
        };

        const update = () => {
            rafIdRef.current = null;
            setOverdrag(isMapOverdragged(map));
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
            <SupplementTooltip point={supplementHover} />
            {map && <MapContextMenu map={map} />}
        </>
    );
};

export default Map;
