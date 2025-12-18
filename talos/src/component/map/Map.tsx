import React, { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import styles from './Map.module.scss';
import { useMap } from './useMap';
import L from 'leaflet';

interface MapProps {
    onMapReady?: (mapInstance: L.Map) => void;
}

const Map: React.FC<MapProps> = ({ onMapReady }) => {
    const mapElementRef = useRef<HTMLDivElement>(null);
    const { map } = useMap(mapElementRef.current);
    const [isOverdrag, setIsOverdrag] = useState(false);

    const isOverdragRef = useRef(false);
    const rafIdRef = useRef<number | null>(null);

    useEffect(() => {
        if (map && onMapReady) {
            onMapReady(map);
        }
    }, [map, onMapReady]);

    useEffect(() => {
        if (!map) return;

        const update = () => {
            rafIdRef.current = null;
            const maxBounds = map.options.maxBounds;
            if (!maxBounds) return;
            const max = L.latLngBounds(maxBounds);
            const view = map.getBounds();

            // 任意边界越界：只要视口 bounds 不被 maxBounds 完整包含，就算 overdrag
            const over = !max.contains(view);
            if (over === isOverdragRef.current) return;
            isOverdragRef.current = over;
            setIsOverdrag(over);
        };

        const onDrag = () => {
            if (rafIdRef.current !== null) return;
            rafIdRef.current = requestAnimationFrame(update);
        };

        const clear = () => {
            if (!isOverdragRef.current) return;
            isOverdragRef.current = false;
            setIsOverdrag(false);
        };

        map.on('drag', onDrag);
        map.on('dragend', clear);
        map.on('zoomstart', clear);
        map.on('movestart', clear);
        map.on('moveend', clear);

        return () => {
            map.off('drag', onDrag);
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
        <div
            ref={mapElementRef}
            className={`${styles.mapContainer} ${isOverdrag ? styles.overdrag : ''}`}
            id='map'
        ></div>
    );
};

export default Map;
