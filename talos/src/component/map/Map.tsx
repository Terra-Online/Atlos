import React, { useEffect, useRef } from 'react';
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

    useEffect(() => {
        if (map && onMapReady) {
            onMapReady(map);
        }
    }, [map, onMapReady]);

    return (
        <div ref={mapElementRef} className={styles.mapContainer} id='map'></div>
    );
};

export default Map;
