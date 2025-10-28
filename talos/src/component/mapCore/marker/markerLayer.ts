import { REGION_DICT } from '@/data/map';
import { IMarkerData, MARKER_TYPE_DICT, SUBREGION_MARKS_MAP, } from '@/data/marker';
import LOGGER from '@/utils/log';
import L from 'leaflet';
import { getMarkerLayer } from './markerRenderer';

// leaflet renderer
export class MarkerLayer {
    /**
     * 绑定的地图实例
     */
    map: L.Map;
    /**
     * 子区域到存放该区域marker的LayerGroup映射
     */
    layerSubregionDict: Record<string, L.LayerGroup> = {};

    /**
     * marker唯一id到marker Layer映射
     */
    markerDict: Record<string, L.Layer> = {};

    /**
     * marker唯一id到markerData映射
     */
    markerDataDict: Record<string, IMarkerData> = {};

    /**
     * type唯一id到markerId列表映射
     */
    markerTypeMap: Record<string, string[]> = {};

    private _onSwitchCurrentMarker?: (marker: IMarkerData) => void;

    constructor(
        map: L.Map,
        onSwitchCurrentMarker?: (marker: IMarkerData) => void,
    ) {
        this.map = map;
        this._onSwitchCurrentMarker = onSwitchCurrentMarker;
        // 初始化markerType到markerId列表的映射
        this.markerTypeMap = Object.values(MARKER_TYPE_DICT).reduce(
            (acc, type) => {
                acc[type.key] = [];
                return acc;
            },
            {},
        );

        // 为每个subregion生成LayerGroup
        this.layerSubregionDict = Object.values(REGION_DICT).reduce(
            (acc, region) => {
                region.subregions.forEach((subregion) => {
                    acc[subregion] = new L.LayerGroup([], {
                        pane: 'markerPane',
                    });
                });
                return acc;
            },
            {},
        );

        // 导入全图marker
        this.importMarker(Object.values(SUBREGION_MARKS_MAP).flat());
    }

    /**
     * 导入marker列表
     */
    importMarker(markers: IMarkerData[]) {
        markers.forEach((marker) => {
            const typeKey = marker.type;
            if (!this.markerTypeMap[typeKey]) {
                LOGGER.warn(`Missing type config for '${typeKey}'`);
                return;
            }

            this.markerDict[marker.id] = getMarkerLayer(marker, this._onSwitchCurrentMarker);
            this.markerDataDict[marker.id] = marker;

            this.markerTypeMap[typeKey].push(marker.id);
            // layer.addTo(this.layerSubregionDict[marker.region.sub]);
        });
    }

    changeRegion(regionId: string) {
        Object.values(this.layerSubregionDict).forEach((layer) => {
            layer.removeFrom(this.map);
        });
        const subregions = REGION_DICT[regionId].subregions;
        subregions.forEach((subregion) => {
            this.layerSubregionDict[subregion].addTo(this.map);
        });
    }

    filterMarker(typeKeys: string[]) {
        const markerIds = typeKeys.flatMap((key) => this.markerTypeMap[key] || []);
        Object.entries(this.markerDict).forEach(([id, layer]) => {
            const parent =
                this.layerSubregionDict[this.markerDataDict[id].subregionId];
            if (markerIds.includes(id)) {
                layer.addTo(parent);
            } else {
                // @ts-expect-error leaflet官方文档支持从layerGroup中移除，这里的Map类型要求是错误的
                layer.remove(parent);
            }
        });
    }

    /**
     * 初始化时渲染已选中的 filter 对应的 markers
     * 应在 changeRegion 之后调用
     */
    initializeWithFilter(typeKeys: string[]) {
        if (typeKeys.length === 0) return;
        this.filterMarker(typeKeys);
    }

    getCurrentPoints(regionId: string) {
        const subregions = REGION_DICT[regionId].subregions;
        const points = Object.values(this.markerDataDict);
        return points.filter((point) => subregions.includes(point.subregionId));
    }
}
