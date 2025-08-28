import useRegion from "@/store/region";
import { MapCore } from "../mapCore/map";
import { DEFAULT_REGION, REGION_DICT, SUBREGION_DICT } from "@/data/map";
import { useEffect, useRef, useState } from "react";
import { createHighlight } from "@/utils/visual";
import { useMarkerStore } from "@/store/marker";

// Assmeble all stores to useMap
export function useMap(ele: HTMLDivElement) {

    const { currentRegionKey: currentRegion, setCurrentRegion, setCurrentSubregion, currentSubregionKey: currentSubregion } = useRegion()
    const { filter } = useMarkerStore()

    const mapRef = useRef<MapCore | null>(null);
    const [LMap, setLMap] = useState<L.Map | null>(null);
    // initMap
    useEffect(() => {
        mapRef.current = new MapCore(ele, {
            onSwitchCurrentMarker: (marker) => {
                useMarkerStore.setState({ currentActivePoint: marker })
            }
        });
        setLMap(mapRef.current.map);
    }, []);

    // alterMap
    useEffect(() => {
        if (mapRef.current) {
            mapRef.current.switchRegion(currentRegion ?? DEFAULT_REGION);
        }
    }, [currentRegion]);

    const selectSubregion = (subregionId) => {
        const subregion = SUBREGION_DICT[subregionId];
        if (!subregion) return;

        setCurrentSubregion(subregion.id);

        if (subregion.bounds && subregion.bounds.length >= 2) {
            const [[x1, y1], [x2, y2]] = subregion.bounds;
            const centerX = (x1 + x2) / 2;
            const centerY = (y1 + y2) / 2;

            const config = REGION_DICT[currentRegion];
            const center = mapRef.current!.map.unproject([centerX, centerY], config.maxZoom);

            mapRef.current?.map.once('moveend', () => {
                createHighlight(mapRef.current?.map, subregion, config);
            });

            mapRef.current?.setMapView({ lat: center.lat, lng: center.lng, zoom: 1 });
        }
    };




    // set filter
    useEffect(() => {
        const markerLayer = mapRef.current?.markerLayer;
        markerLayer?.filterMarker(filter);
        useMarkerStore.setState({ points: markerLayer?.getCurrentPoints(currentRegion).map(point => point.id) ?? [] })
    }, [filter, currentRegion]);

    return {
        map: LMap,
        currentRegion,
        currentSubregion,
        setCurrentRegion,
        setCurrentSubregion: selectSubregion,
    };
}