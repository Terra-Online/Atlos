import { REGION_DICT } from '@/data/map';
import { IMarkerData, MARKER_TYPE_DICT, loadRegionMarkers } from '@/data/marker';
import LOGGER from '@/utils/log';
import L from 'leaflet';
import { getMarkerLayer } from './markerRenderer';
import styles from './marker.module.scss';
import { ClusterLayer } from './clusterLayer';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { getActivePoints } from '@/store/userRecord';
import { useMarkerStore } from '@/store/marker';
import { registerLassoHandler } from '@/component/settings/useMapMultiSelect';
import { convertMapMarkerToEFGamePosition, type EFGamePosition, type RegionProfile } from '@/utils/endfield/locatorTransform';

const LOCATOR_PROXIMITY_XZ_METERS = 20;
const LOCATOR_PROXIMITY_Y_METERS = 6;

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
    private pulseCleanupDict: Record<string, () => void> = {};
    private proximityPulseIds = new Set<string>();
    private temporaryVisibleIds = new Set<string>();
    private proximityUpdateSeq = 0;

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
        this.clearProximityReminder();
        Object.values(this.pulseCleanupDict).forEach((cleanup) => cleanup());
        this.pulseCleanupDict = {};
    }

    private getMarkerInnerElement(id: string): HTMLElement | null {
        const layer = this.markerDict[id];
        if (!(layer instanceof L.Marker)) return null;
        const markerRoot = layer.getElement();
        if (!markerRoot) return null;
        return markerRoot.querySelector<HTMLElement>(`.${styles.markerInner}, .${styles.noFrameInner}`);
    }

    stopMarkerPulse(id: string) {
        const cleanup = this.pulseCleanupDict[id];
        if (!cleanup) return;
        cleanup();
        delete this.pulseCleanupDict[id];
    }

    startMarkerPulse(id: string): boolean {
        this.stopMarkerPulse(id);
        const inner = this.getMarkerInnerElement(id);
        if (!inner) return false;

        const classSignature = () =>
            Array.from(inner.classList)
                .filter((cls) => cls !== styles.pulsing)
                .sort()
                .join(' ');

        const initialSignature = classSignature();
        inner.classList.add(styles.pulsing);

        const observer = new MutationObserver(() => {
            if (!inner.isConnected) {
                this.stopMarkerPulse(id);
                return;
            }
            if (classSignature() !== initialSignature) {
                this.stopMarkerPulse(id);
            }
        });

        observer.observe(inner, {
            attributes: true,
            attributeFilter: ['class'],
        });

        this.pulseCleanupDict[id] = () => {
            observer.disconnect();
            inner.classList.remove(styles.pulsing);
        };

        return true;
    }

    clearProximityReminder() {
        this.proximityUpdateSeq += 1;
        this.proximityPulseIds.forEach((id) => this.stopMarkerPulse(id));
        this.proximityPulseIds.clear();
    }

    private syncTemporaryVisibleMarkers() {
        this.clusterLayer.setTemporaryVisibleIds(this.temporaryVisibleIds);
    }

    updateProximityReminder(params: {
        currentRegion: string | null | undefined;
        subregionKey?: string | null;
        locatorProfile?: RegionProfile | null;
        position: EFGamePosition;
        typeKeys: string[];
    }) {
        const { currentRegion, subregionKey, locatorProfile, position, typeKeys } = params;
        if (!currentRegion || typeKeys.length === 0) {
            this.clearProximityReminder();
            return;
        }

        const activeTypeKeys = new Set(typeKeys);
        const activeSubregions = new Set(REGION_DICT[currentRegion]?.subregions ?? []);
        if (activeSubregions.size === 0) {
            this.clearProximityReminder();
            return;
        }

        const markerStore = useMarkerStore.getState();
        const collected = new Set(getActivePoints());
        const selected = new Set(markerStore.selectedPoints);
        const nextPulseIds = new Set<string>();

        Object.values(this.markerDataDict).forEach((markerData) => {
            if (!activeSubregions.has(markerData.subregId)) return;
            if (subregionKey && markerData.subregId !== subregionKey) return;
            if (!activeTypeKeys.has(markerData.type)) return;

            if (collected.has(markerData.id)) {
                this.stopMarkerPulse(markerData.id);
                return;
            }

            const markerGamePosition = convertMapMarkerToEFGamePosition(markerData, currentRegion, locatorProfile);
            const inRange = Math.abs(markerGamePosition.x - position.x) < LOCATOR_PROXIMITY_XZ_METERS
                && Math.abs(markerGamePosition.z - position.z) < LOCATOR_PROXIMITY_XZ_METERS
                && Math.abs(markerGamePosition.y - position.y) < LOCATOR_PROXIMITY_Y_METERS;

            if (!inRange) return;

            nextPulseIds.add(markerData.id);
            if (!selected.has(markerData.id)) {
                useMarkerStore.getState().setSelected(markerData.id, true);
                this.updateSelectedMarkers([{ id: markerData.id, selected: true }]);
            }
        });

        this.proximityPulseIds.forEach((id) => {
            if (!nextPulseIds.has(id)) {
                this.stopMarkerPulse(id);
            }
        });

        const seq = ++this.proximityUpdateSeq;
        this.proximityPulseIds = nextPulseIds;

        const showPulses = async () => {
            for (const id of nextPulseIds) {
                if (seq !== this.proximityUpdateSeq) return;
                if (collected.has(id)) continue;
                if (!this.pulseCleanupDict[id]) {
                    await this.ensureMarkerVisible(id);
                }
                if (seq !== this.proximityUpdateSeq) return;
                if (getActivePoints().includes(id)) {
                    this.stopMarkerPulse(id);
                    continue;
                }
                if (!this.pulseCleanupDict[id]) {
                    this.startMarkerPulse(id);
                }
            }
        };

        void showPulses();
    }

    async ensureMarkerVisible(id: string): Promise<boolean> {
        const markerData = this.markerDataDict[id];
        const layer = this.markerDict[id];
        if (!markerData || !layer) return false;

        if (this.clusterLayer.isEnabled() && this.clusterLayer.isTypeManaged(markerData.type)) {
            const shown = await this.clusterLayer.showMarker(id);
            if (!shown) return false;
        } else {
            const parent = this.layerSubregionDict[markerData.subregId];
            if (!parent || !this.map.hasLayer(parent)) return false;
            if (!parent.hasLayer(layer)) {
                layer.addTo(parent);
            }
        }

        if (this.activeFilterKeys.includes(markerData.type)) {
            this.temporaryVisibleIds.delete(id);
        } else {
            this.temporaryVisibleIds.add(id);
        }
        this.syncTemporaryVisibleMarkers();

        for (let i = 0; i < 20; i++) {
            const inner = this.getMarkerInnerElement(id);
            if (inner) {
                inner.classList.remove(styles.disappearing);
                return true;
            }
            await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
        }

        return false;
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
                    this.stopMarkerPulse(id);
                    this.proximityPulseIds.delete(id);
                    this.temporaryVisibleIds.delete(id);
                    this.syncTemporaryVisibleMarkers();
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

                        const parent = this.layerSubregionDict[markerData.subregId];
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
        const newMarkerIds: string[] = [];

        markers.forEach((marker) => {
            if (this.markerDataDict[marker.id]) return;

            const typeKey = marker.type;
            if (!this.markerTypeMap[typeKey]) {
                LOGGER.warn(`Missing type config for '${typeKey}'`);
                return;
            }

            this.markerDict[marker.id] = getMarkerLayer(marker, this._onSwitchCurrentMarker, this.collectedPoints);
            this.markerDataDict[marker.id] = marker;

            this.markerTypeMap[typeKey].push(marker.id);
            newMarkerIds.push(marker.id);
            // layer.addTo(this.layerSubregionDict[marker.region.sub]);
        });

        if (newMarkerIds.length > 0) {
            this.clusterLayer.notifyMarkersAdded(newMarkerIds);
        }
    }

    async changeRegion(regionId: string) {
        this.temporaryVisibleIds.clear();
        this.syncTemporaryVisibleMarkers();
        this.proximityPulseIds.forEach((id) => this.stopMarkerPulse(id));
        this.proximityPulseIds.clear();

        Object.values(this.layerSubregionDict).forEach((layer) => {
            layer.removeFrom(this.map);
        });

        const subregions = REGION_DICT[regionId].subregions;
        subregions.forEach((subregion) => {
            this.layerSubregionDict[subregion].addTo(this.map);
        });

        this.clusterLayer.setActiveSubregions(subregions);
        const markers = await loadRegionMarkers(regionId);
        this.importMarker(markers);

        if (this.clusterLayer.isEnabled()) {
            this.clusterLayer.applyFilter(this.activeFilterKeys);
        }
        this.filterMarker(this.activeFilterKeys);
        useMarkerStore.getState().bumpMarkerDataVersion();
    }

    filterMarker(typeKeys: string[]) {
        this.activeFilterKeys = typeKeys;
        const activeTypeSet = new Set(typeKeys);
        this.temporaryVisibleIds.forEach((id) => {
            const markerData = this.markerDataDict[id];
            if (markerData && activeTypeSet.has(markerData.type)) {
                this.temporaryVisibleIds.delete(id);
            }
        });
        this.syncTemporaryVisibleMarkers();
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
            const parent = this.layerSubregionDict[markerData.subregId];

            if (clusterEnabled && this.clusterLayer.isTypeManaged(markerData.type)) {
                if (parent?.hasLayer(layer)) {
                    parent.removeLayer(layer);
                }
                return;
            }

            // Check if marker should be shown: must be in filter AND not completed (if hiding completed is enabled)
            const shouldShow = (markerIdsSet.has(id) || this.temporaryVisibleIds.has(id)) && !completedMarkerIds.has(id);
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
                this.stopMarkerPulse(id);
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
        return points.filter((point) => subregions.includes(point.subregId));
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
