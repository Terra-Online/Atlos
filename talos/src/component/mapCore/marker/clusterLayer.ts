import L from 'leaflet';
import 'leaflet.markercluster';
import { IMarkerData, IMarkerType } from '@/data/marker';
import { getItemIconUrl, getMarkerSubIconUrl } from '@/utils/resource';
import styles from './marker.module.scss';

const CLUSTER_MAIN_WHITELIST = new Set(['enemy', 'resource']); // manually maintained for now, may expand as a custom list determined by user settings

interface ClusterLayerDeps {
    map: L.Map;
    getMarkerDict: () => Record<string, L.Layer>;
    getMarkerDataDict: () => Record<string, IMarkerData>;
    getMarkerTypeMap: () => Record<string, string[]>;
    getLayerSubregionDict: () => Record<string, L.LayerGroup>;
}

export class ClusterLayer {
    private readonly clusterGroupsByType: Record<string, L.MarkerClusterGroup> = {};
    private enabled = false;
    private filterKeys: string[] = [];
    private activeSubregions = new Set<string>();
    /**
     * 延迟移除定时器，和普通点位保持一致，用于淡出动画
     */
    private pendingRemovalTimers: Record<string, number> = {};

    constructor(private readonly deps: ClusterLayerDeps) {}

    registerType(type: IMarkerType) {
        if (!CLUSTER_MAIN_WHITELIST.has(type.category.main)) {
            return;
        }
        if (this.clusterGroupsByType[type.key]) {
            return;
        }
        const iconUrl = getItemIconUrl(type.key);
        const hasSubIcon = Boolean(type.subIcon);
        const subIconUrl = hasSubIcon && type.subIcon ? getMarkerSubIconUrl(type.subIcon) : '';

        this.clusterGroupsByType[type.key] = L.markerClusterGroup({
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            spiderfyOnMaxZoom: true,
            disableClusteringAtZoom: 2,
            maxClusterRadius: 60,
            iconCreateFunction: (cluster) => {
                const count = cluster.getChildCount();

                if (type.noFrame) {
                    return L.divIcon({
                        html: `<div class="${styles.noFrameInner} ${styles.clusterMarker}">
                                  <img src="${iconUrl}" class="${styles.noFrameImage}" alt="${type.key}" />
                                  <span class="${styles.clusterCount}">${count}</span>
                               </div>`,
                        className: `${styles.noFrameMarkerIcon} marker-cluster-custom`,
                        iconSize: [50, 50],
                        iconAnchor: [25, 25],
                    });
                }

                if (hasSubIcon) {
                    return L.divIcon({
                        html: `<div class="${styles.markerInner} ${styles.clusterMarker}">
                                  <div class="${styles.FrameImage}" style="background-image: url(${iconUrl})"></div>
                                  <div class="${styles.subIconContainer}">
                                      <div class="${styles.subIcon}" style="background-image: url(${subIconUrl})"></div>
                                  </div>
                                  <span class="${styles.clusterCount}">${count}</span>
                               </div>`,
                        className: `${styles.FrameMarkerIcon} marker-cluster-custom`,
                        iconSize: [32, 32],
                        iconAnchor: [16, 16],
                    });
                }

                return L.divIcon({
                    html: `<div class="${styles.markerInner} ${styles.clusterMarker}">
                              <div class="${styles.FrameImage}" style="background-image: url(${iconUrl})"></div>
                              <span class="${styles.clusterCount}">${count}</span>
                           </div>`,
                    className: `${styles.FrameMarkerIcon} marker-cluster-custom`,
                    iconSize: [32, 32],
                    iconAnchor: [16, 16],
                });
            },
        });
    }

    setActiveSubregions(subregions: string[]) {
        this.activeSubregions = new Set(subregions);
        if (this.enabled) {
            this.refreshClusters();
        }
    }

    applyFilter(typeKeys: string[]) {
        this.filterKeys = typeKeys;
        if (this.enabled) {
            this.refreshClusters(); // 增量刷新
        } else {
            this.removeClustersFromMap();
        }
    }

    enable() {
        if (this.enabled) return;
        this.enabled = true;
        this.refreshClusters();
    }

    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        this.removeClustersFromMap();
    }

    notifyMarkersAdded(newIds: string[]) {
        // 聚合未开启或没有过滤，直接返回（当开启后由 refreshClusters 统一处理）
        if (!this.enabled || this.filterKeys.length === 0) return;

        const markerDict = this.deps.getMarkerDict();
        const markerDataDict = this.deps.getMarkerDataDict();
        const layerSubregionDict = this.deps.getLayerSubregionDict();

        // 仅对当前过滤的、受管理的类型进行增量添加，避免整组重算造成闪烁
        const activeManagedTypes = this.filterKeys.filter((k) => this.clusterGroupsByType[k]);

        activeManagedTypes.forEach((typeKey) => {
            const clusterGroup = this.clusterGroupsByType[typeKey];
            if (!clusterGroup) return;

            newIds.forEach((id) => {
                const data = markerDataDict[id];
                if (!data) return;
                if (data.type !== typeKey) return; // 只处理对应类型
                if (!this.activeSubregions.has(data.subregionId)) return; // 只处理当前活跃子区域

                const layer = markerDict[id];
                if (!layer) return;
                const parentGroup = layerSubregionDict[data.subregionId];
                // 如果原来在父 LayerGroup 中，移除以避免与聚合重复显示
                if (parentGroup?.hasLayer(layer)) {
                    parentGroup.removeLayer(layer);
                }

                // 取消可能的延迟移除
                if (this.pendingRemovalTimers[id] !== undefined) {
                    clearTimeout(this.pendingRemovalTimers[id]);
                    delete this.pendingRemovalTimers[id];
                }

                clusterGroup.addLayer(layer); // 静默加入，不清空其他
            });

            if (clusterGroup.getLayers().length > 0 && !this.deps.map.hasLayer(clusterGroup)) {
                clusterGroup.addTo(this.deps.map);
            }
        });
    }

    isEnabled() {
        return this.enabled;
    }

    isTypeManaged(typeKey: string) {
        return Boolean(this.clusterGroupsByType[typeKey]);
    }

    private refreshClusters() {
        if (!this.enabled) return;

        const map = this.deps.map;
        const markerDict = this.deps.getMarkerDict();
        const markerDataDict = this.deps.getMarkerDataDict();
        const markerTypeMap = this.deps.getMarkerTypeMap();
        const layerSubregionDict = this.deps.getLayerSubregionDict();

        const activeManagedTypes = this.filterKeys.filter((key) => this.clusterGroupsByType[key]);

        // 为每个受管理类型做增量 diff
        Object.entries(this.clusterGroupsByType).forEach(([typeKey, clusterGroup]) => {
            const shouldBeActive = activeManagedTypes.includes(typeKey);

            // 目标集合（需要在聚合中的点位）
            const desiredIds = shouldBeActive
                ? (markerTypeMap[typeKey] ?? []).filter((id) => {
                      const d = markerDataDict[id];
                      return d && this.activeSubregions.has(d.subregionId);
                  })
                : [];
            const desiredSet = new Set(desiredIds);

            // 当前集合（已经在聚合中的点位）
            const currentIds = (markerTypeMap[typeKey] ?? []).filter((id) => {
                const layer = markerDict[id];
                return layer && clusterGroup.hasLayer(layer);
            });
            const currentSet = new Set(currentIds);

            // 计算增量
            const toAdd = desiredIds.filter((id) => !currentSet.has(id));
            const toRemove = currentIds.filter((id) => !desiredSet.has(id));

            // 处理移除，添加淡出
            toRemove.forEach((id) => {
                const layer = markerDict[id];
                const data = markerDataDict[id];
                if (!layer || !data) return;
                this.fadeOutAndRemove(clusterGroup, id, layer);
            });

            // 处理新增，静默加入
            toAdd.forEach((id) => {
                const layer = markerDict[id];
                const data = markerDataDict[id];
                if (!layer || !data) return;
                const parentGroup = layerSubregionDict[data.subregionId];
                if (parentGroup?.hasLayer(layer)) {
                    parentGroup.removeLayer(layer);
                }
                // 取消可能的延迟移除
                if (this.pendingRemovalTimers[id] !== undefined) {
                    clearTimeout(this.pendingRemovalTimers[id]);
                    delete this.pendingRemovalTimers[id];
                }
                clusterGroup.addLayer(layer);
            });

            // 如果该类型现在应该展示并且有点位则确保加入地图；否则如果不再需要并且无活动标记则从地图移除
            if (shouldBeActive && clusterGroup.getLayers().length > 0) {
                if (!map.hasLayer(clusterGroup)) {
                    clusterGroup.addTo(map);
                }
            } else if (!shouldBeActive) {
                // 如果处于淡出阶段，等待全部 timer 完成后移除 group；简单策略：无层时立即移除
                if (clusterGroup.getLayers().length === 0 && map.hasLayer(clusterGroup)) {
                    map.removeLayer(clusterGroup);
                }
            }
        });
    }

    private fadeOutAndRemove(clusterGroup: L.MarkerClusterGroup, markerId: string, layer: L.Layer) {
        const markerRoot = (layer as L.Marker).getElement?.() as HTMLElement | null;
        if (markerRoot) {
            const inner = markerRoot.querySelector<HTMLElement>(`.${styles.markerInner}, .${styles.noFrameInner}`);
            if (inner) {
                inner.classList.add(styles.disappearing);
            }
        }
        if (this.pendingRemovalTimers[markerId] !== undefined) {
            clearTimeout(this.pendingRemovalTimers[markerId]);
        }
        this.pendingRemovalTimers[markerId] = window.setTimeout(() => {
            clusterGroup.removeLayer(layer);
            delete this.pendingRemovalTimers[markerId];
            // 如果该 clusterGroup 已无层并且不应再显示，则从地图移除
            if (clusterGroup.getLayers().length === 0 && this.deps.map.hasLayer(clusterGroup)) {
                this.deps.map.removeLayer(clusterGroup);
            }
        }, 160);
    }

    private removeClustersFromMap() {
        const map = this.deps.map;
        Object.values(this.clusterGroupsByType).forEach((clusterGroup) => {
            clusterGroup.clearLayers();
            if (map.hasLayer(clusterGroup)) {
                map.removeLayer(clusterGroup);
            }
        });
    }
}
