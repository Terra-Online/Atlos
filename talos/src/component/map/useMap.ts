import useRegion from '@/store/region';
import { MapCore } from '../mapCore/map';
import { DEFAULT_REGION, REGION_DICT, SUBREGION_DICT } from '@/data/map';
import { useEffect, useRef, useState } from 'react';
import { createHighlight } from './visual';
import { useMarkerStore } from '@/store/marker';
import { useMarker } from './useMarker';
import { useTriggerBoundary, useTriggerCluster } from '@/store/uiPrefs';
import { useCurrentLayer } from '@/store/layer';
import L from 'leaflet';

// Hook for map initialization and region management
export function useMap(ele: HTMLDivElement | null) {
    const {
        currentRegionKey: currentRegion,
        setCurrentRegion,
        setCurrentSubregion,
        currentSubregionKey: currentSubregion,
    } = useRegion();

    const triggerBoundary = useTriggerBoundary();
    const triggerCluster = useTriggerCluster();
    const currentLayer = useCurrentLayer();
    const mapRef = useRef<MapCore | null>(null);
    const [LMap, setLMap] = useState<L.Map | null>(null);
    const [mapInitialized, setMapInitialized] = useState(false);

    // initMap
    useEffect(() => {
        if (!ele || mapRef.current) return;

        mapRef.current = new MapCore(ele, {
            onSwitchCurrentMarker: (marker) => {
                useMarkerStore.getState().setCurrentActivePoint(marker);
            },
        });
        setLMap(mapRef.current.map);
        setMapInitialized(true);
    }, [ele]);

    // 初始化地图区域（只在地图初始化或区域切换时触发）
    useEffect(() => {
        if (!mapRef.current || !mapInitialized) return;
        const target = currentRegion ?? DEFAULT_REGION;
        if (mapRef.current.currentRegionId === target) return;
        void mapRef.current.switchRegion(target);
    }, [currentRegion, mapInitialized]);

    // 抽出的useMarker用来管理点位逻辑
    useMarker(mapRef.current, currentRegion, mapInitialized);

    // 监听子区域切换请求
    const subregionSwitchRequest = useRegion((state) => state.subregionSwitchRequest);
    const clearSubregionSwitchRequest = useRegion((state) => state.clearSubregionSwitchRequest);

    useEffect(() => {
        if (!subregionSwitchRequest || !mapRef.current) return;

        const subregionId = subregionSwitchRequest;
        const subregion = SUBREGION_DICT[subregionId];
        if (!subregion) {
            clearSubregionSwitchRequest();
            return;
        }

        // 找到该子区域所属的主区域
        let targetRegionKey = currentRegion;
        for (const [regionKey, regionConfig] of Object.entries(REGION_DICT)) {
            if (regionConfig.subregions.includes(subregionId)) {
                targetRegionKey = regionKey;
                break;
            }
        }

        // 内部选择函数
        const selectSubregionInternal = (regionKey: string) => {
            const subregion = SUBREGION_DICT[subregionId];
            if (!subregion || !mapRef.current) return;

            setCurrentSubregion(subregion.id);

            if (subregion.bounds && subregion.bounds.length >= 2) {
                const [[x1, y1], [x2, y2]] = subregion.bounds;
                const centerX = (x1 + x2) / 2;
                const centerY = (y1 + y2) / 2;

                const config = REGION_DICT[regionKey];
                const center = mapRef.current.map.unproject(
                    [centerX, centerY],
                    config.maxZoom,
                );

                mapRef.current.map.once('moveend', () => {
                    createHighlight(mapRef.current?.map, subregion, config);
                });

                mapRef.current.setMapView({
                    lat: center.lat,
                    lng: center.lng,
                    zoom: 1,
                });
            }
        };

        // 如果子区域不属于当前主区域，先切换主区域
        const run = async () => {
            const mapCore = mapRef.current;
            if (targetRegionKey !== currentRegion && mapCore) {
                // 直接切换地图区域并等待底图加载完成，避免使用任意超时
                await mapCore.switchRegion(targetRegionKey);
                // 同步更新 store 状态（不会重复切换，下面的 effect 有去重）
                setCurrentRegion(targetRegionKey);
            }
            selectSubregionInternal(targetRegionKey);
            clearSubregionSwitchRequest();
        };
        void run();
    }, [subregionSwitchRequest, currentRegion, setCurrentRegion, setCurrentSubregion, clearSubregionSwitchRequest]);

    // 监听边界显示触发器状态
    useEffect(() => {
        if (!mapRef.current || !mapInitialized) return;

        if (triggerBoundary) {
            mapRef.current.showSubregionBoundaries();
        } else {
            mapRef.current.hideSubregionBoundaries();
        }
    }, [triggerBoundary, mapInitialized, currentRegion]);

    // 监听聚合触发器状态
    useEffect(() => {
        if (!mapRef.current || !mapInitialized) return;

        if (triggerCluster) {
            mapRef.current.enableMarkerClustering();
        } else {
            mapRef.current.disableMarkerClustering();
        }
    }, [triggerCluster, mapInitialized]);

    // 监听图层切换
    useEffect(() => {
        if (!mapRef.current || !mapInitialized) return;
        void mapRef.current.switchLayer(currentLayer);
    }, [currentLayer, mapInitialized]);

    return {
        map: LMap,
        currentRegion,
        currentSubregion,
        setCurrentRegion,
        setCurrentSubregion,
    };
}