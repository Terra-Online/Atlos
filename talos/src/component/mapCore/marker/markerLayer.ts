import { REGION_DICT } from '@/data/map';
import { IMarkerData, MARKER_TYPE_DICT, SUBREGION_MARKS_MAP, } from '@/data/marker';
import LOGGER from '@/utils/log';
import L from 'leaflet';
import { getMarkerLayer } from './markerRenderer';
import styles from './marker.module.scss';
import { ClusterLayer } from './clusterLayer';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { getActivePoints } from '@/store/userRecord';
import { registerLassoHandler } from '@/component/settings/useMapMultiSelect';

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

    private clusterLayer: ClusterLayer;
    private activeFilterKeys: string[] = [];

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

    /**
     * 已收集的点位列表
     */
    collectedPoints: string[] = [];

    private _onSwitchCurrentMarker?: (marker: IMarkerData) => void;
    /**
     * 延迟移除的定时器，避免直接移除导致无法看到淡出动画
     */
    private pendingRemovalTimers: Record<string, number> = {};

    /** Teardown function returned by registerLassoHandler — removes map listeners. */
    private _destroyLasso?: () => void;

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

        this.clusterLayer = new ClusterLayer({
            map: this.map,
            getMarkerDict: () => this.markerDict,
            getMarkerDataDict: () => this.markerDataDict,
            getMarkerTypeMap: () => this.markerTypeMap,
            getLayerSubregionDict: () => this.layerSubregionDict,
        });

        Object.values(MARKER_TYPE_DICT).forEach((type) => {
            this.clusterLayer.registerType(type);
        });

        // 导入全图marker
        this.importMarker(Object.values(SUBREGION_MARKS_MAP).flat());

        // Register lasso selection handler for Cmd/Ctrl+drag multi-select
        this._destroyLasso = registerLassoHandler(this.map, {
            markerDataDict: this.markerDataDict,
            markerDict: this.markerDict,
            innerSelector: `.${styles.markerInner}, .${styles.noFrameInner}`,
            selectedClassName: styles.selected,
            stateClassNames: [
                styles.selected,
                styles.checked,
                styles.appearing,
                styles.disappearing,
            ],
            getActiveFilterKeys: () => this.activeFilterKeys,
            isSubregionVisible: (subregionId) =>
                this.map.hasLayer(this.layerSubregionDict[subregionId]),
        });
    }

    /**
     * Remove all map-level listeners set up by this MarkerLayer.
     * Call this when the layer is being permanently torn down.
     */
    destroy() {
        this._destroyLasso?.();
    }

    /**
     * 更新已收集的点位列表
     */
    updateCollectedPoints(collectedPoints: string[]) {
        const prevCollected = new Set(this.collectedPoints);
        const newCollected = new Set(collectedPoints);

        this.collectedPoints = collectedPoints;

        // 获取是否隐藏已完成点位的设置
        const shouldHideCompleted = useUiPrefsStore.getState().prefsHideCompletedMarkers;
        const clusterEnabled = this.clusterLayer.isEnabled();

        // 更新所有 marker 的 checked 类
        Object.entries(this.markerDict).forEach(([id, layer]) => {
            const markerRoot = (layer as L.Marker).getElement?.() as HTMLElement | null;
            if (!markerRoot) return;
            const inner = markerRoot.querySelector(`.${styles.markerInner}, .${styles.noFrameInner}`);
            if (!inner) return;

            const wasCollected = prevCollected.has(id);
            const isCollected = newCollected.has(id);

            if (wasCollected !== isCollected) {
                if (isCollected) {
                    inner.classList.add(styles.checked);

                    // 如果开启了隐藏已完成点位，执行 fadeout 动画后移除
                    if (shouldHideCompleted) {
                        const markerData = this.markerDataDict[id];
                        if (!markerData) return;

                        // 如果是聚合管理的类型，通知聚合层刷新
                        if (clusterEnabled && this.clusterLayer.isTypeManaged(markerData.type)) {
                            this.clusterLayer.applyFilter(this.activeFilterKeys);
                            return;
                        }

                        const parent = this.layerSubregionDict[markerData.subregionId];
                        if (!parent?.hasLayer(layer)) return;

                        // 添加淡出动画类
                        inner.classList.add(styles.disappearing);

                        // 取消之前的延迟移除定时器
                        if (this.pendingRemovalTimers[id] !== undefined) {
                            clearTimeout(this.pendingRemovalTimers[id]);
                        }
                        // 延迟移除，等待淡出动画完成
                        this.pendingRemovalTimers[id] = window.setTimeout(() => {
                            // @ts-expect-error leaflet官方文档支持从layerGroup中移除
                            layer.remove(parent);
                            delete this.pendingRemovalTimers[id];
                        }, 160);
                    }
                } else {
                    inner.classList.remove(styles.checked);
                }
            }
        });
    }

    // update changed selected points' visual state 
    updateSelectedMarkers(changedSelectedPoints: {id: string, selected: boolean}[]) {
        changedSelectedPoints.forEach(({id, selected}) => {
            const layer = this.markerDict[id];
            if (!layer) return;
            const markerRoot = (layer as L.Marker).getElement?.() as HTMLElement | null;
            if (!markerRoot) return;
            const inner = markerRoot.querySelector(`.${styles.markerInner}, .${styles.noFrameInner}`);
            if (!inner) return;

            inner.classList.toggle(styles.selected, selected);
        });
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

            this.markerDict[marker.id] = getMarkerLayer(marker, this._onSwitchCurrentMarker, this.collectedPoints);
            this.markerDataDict[marker.id] = marker;

            this.markerTypeMap[typeKey].push(marker.id);
            // layer.addTo(this.layerSubregionDict[marker.region.sub]);
        });

        const newMarkerIds = markers.map((marker) => marker.id);
        this.clusterLayer.notifyMarkersAdded(newMarkerIds);
    }

    changeRegion(regionId: string) {
        Object.values(this.layerSubregionDict).forEach((layer) => {
            layer.removeFrom(this.map);
        });

        const subregions = REGION_DICT[regionId].subregions;
        subregions.forEach((subregion) => {
            this.layerSubregionDict[subregion].addTo(this.map);
        });

        this.clusterLayer.setActiveSubregions(subregions);
        if (this.clusterLayer.isEnabled()) {
            this.clusterLayer.applyFilter(this.activeFilterKeys);
        }
    }

    filterMarker(typeKeys: string[]) {
        this.activeFilterKeys = typeKeys;
        this.clusterLayer.applyFilter(typeKeys);

        const clusterEnabled = this.clusterLayer.isEnabled();
        const markerIdsSet = new Set(
            (clusterEnabled
                ? typeKeys.filter((key) => !this.clusterLayer.isTypeManaged(key))
                : typeKeys
            ).flatMap((key) => this.markerTypeMap[key] || []),
        );

        // Get hide completed markers preference
        const shouldHideCompleted = useUiPrefsStore.getState().prefsHideCompletedMarkers;
        const completedMarkerIds = shouldHideCompleted ? new Set(getActivePoints()) : new Set();

        Object.entries(this.markerDict).forEach(([id, layer]) => {
            const markerData = this.markerDataDict[id];
            const parent = this.layerSubregionDict[markerData.subregionId];

            if (clusterEnabled && this.clusterLayer.isTypeManaged(markerData.type)) {
                if (parent?.hasLayer(layer)) {
                    parent.removeLayer(layer);
                }
                return;
            }

            // Check if marker should be shown: must be in filter AND not completed (if hiding completed is enabled)
            const shouldShow = markerIdsSet.has(id) && !completedMarkerIds.has(id);
            const markerRoot = (layer as L.Marker).getElement?.() as HTMLElement | null;
            const inner = markerRoot?.querySelector(`.${styles.markerInner}, .${styles.noFrameInner}`) as HTMLElement | null;

            if (shouldShow) {
                if (this.pendingRemovalTimers[id] !== undefined) {
                    clearTimeout(this.pendingRemovalTimers[id]);
                    delete this.pendingRemovalTimers[id];
                }
                if (inner) inner.classList.remove(styles.disappearing);
                layer.addTo(parent);
            } else {
                if (!parent.hasLayer(layer)) return;
                if (inner) {
                    inner.classList.add(styles.disappearing);
                }
                if (this.pendingRemovalTimers[id] !== undefined) {
                    clearTimeout(this.pendingRemovalTimers[id]);
                }
                this.pendingRemovalTimers[id] = window.setTimeout(() => {
                    // @ts-expect-error leaflet官方文档支持从layerGroup中移除，这里的Map类型要求是错误的
                    layer.remove(parent);
                    delete this.pendingRemovalTimers[id];
                }, 160);
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

    /**
     * 获取当前可见的marker数量（应用filter后的）
     */
    getVisibleMarkerCount(): number {
        const clusterEnabled = this.clusterLayer.isEnabled();

        // 统计当前激活的filter对应的marker数量
        const visibleMarkerIds = (clusterEnabled
            ? this.activeFilterKeys.filter((key) => !this.clusterLayer.isTypeManaged(key))
            : this.activeFilterKeys
        ).flatMap((key) => this.markerTypeMap[key] || []);

        return visibleMarkerIds.length;
    }

    /**
     * 启用聚合模式
     */
    enableClustering() {
        if (this.clusterLayer.isEnabled()) return;
        this.clusterLayer.enable();
        this.clusterLayer.applyFilter(this.activeFilterKeys);
    }

    /**
     * 禁用聚合模式
     */
    disableClustering() {
        if (!this.clusterLayer.isEnabled()) return;
        this.clusterLayer.disable();
        this.filterMarker(this.activeFilterKeys);
    }

    /**
     * 检查是否启用了聚合
     */
    isClusteringEnabled(): boolean {
        return this.clusterLayer.isEnabled();
    }
}
