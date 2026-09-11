import L from 'leaflet';
import { createCanvasAwareClusterGroup } from '../canvasMarkerCluster';
import type { CanvasClusterGroup } from '../clusterGroup';
import { IMarkerData, IMarkerType } from '@/data/marker';
import { getItemIconUrl, getMarkerSubIconUrl } from '@/services/assets/resource';
import styles from './marker.module.scss';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { getActivePoints } from '@/store/userRecord';
import { emitPreviewLeave } from './markerRenderer';

// NOTE: whitelist is based on 2nd-level category (`category.sub`).
// Currently includes ALL known sub categories (see src/data/marker/type.json),
// so behavior is effectively "cluster everything in filter".
// Keep this as an explicit allow-list so it's easy to restrict later.
const CLUSTER_SUBCATEGORY_WHITELIST = new Set<string>([
    'boss',
    'collection',
    'mob',
    'natural',
    'valuable',
    'exploration'
]);

const MARKER_FADE_DURATION_MS = 150;
const MARKER_REMOVAL_DELAY_MS = MARKER_FADE_DURATION_MS + 10;

interface ClusterLayerDeps {
    map: L.Map;
    getMarkerDict: () => Record<string, L.Layer>;
    getMarkerDataDict: () => Record<string, IMarkerData>;
    getMarkerTypeMap: () => Record<string, string[]>;
    getLayerSubregionDict: () => Record<string, L.LayerGroup>;
}

export class ClusterLayer {
    private readonly clusterGroupsByType: Record<string, CanvasClusterGroup> = {};
    private enabled = false;
    private filterKeys: string[] = [];
    private activeSubregions = new Set<string>();
    private temporaryVisibleIds = new Set<string>();
    private checkedVisibleOverrideIds = new Set<string>();
    private pendingRemovalBatches: Record<string, { timer: number; markerIds: Set<string> }> = {};
    private pendingFadeInFrames = new Map<CanvasClusterGroup, number>();

    private batchDepth = 0;
    private refreshPending = false;

    constructor(private readonly deps: ClusterLayerDeps) {}

    batch(operation: () => void) {
        this.batchDepth++;
        try { operation(); }
        finally {
            this.batchDepth--;
            if (!this.batchDepth && this.refreshPending) {
                this.refreshPending = false;
                this.refreshClusters();
            }
        }
    }

    private requestRefresh() {
        if (this.batchDepth) this.refreshPending = true;
        else this.refreshClusters();
    }

    registerType(type: IMarkerType) {
        if (!CLUSTER_SUBCATEGORY_WHITELIST.has(type.category.sub)) {
            return;
        }
        if (this.clusterGroupsByType[type.key]) {
            return;
        }
        const iconUrl = getItemIconUrl(type.key);
        const hasSubIcon = Boolean(type.subIcon);
        const subIconUrl = hasSubIcon && type.subIcon ? getMarkerSubIconUrl(type.subIcon) : '';

        this.clusterGroupsByType[type.key] = createCanvasAwareClusterGroup(this.deps.map, {
            expandOnClick: true,
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
                        iconAnchor: [16, 32],
                    });
                }

                return L.divIcon({
                    html: `<div class="${styles.markerInner} ${styles.clusterMarker}">
                              <div class="${styles.FrameImage}" style="background-image: url(${iconUrl})"></div>
                              <span class="${styles.clusterCount}">${count}</span>
                           </div>`,
                    className: `${styles.FrameMarkerIcon} marker-cluster-custom`,
                    iconSize: [32, 32],
                    iconAnchor: [16, 32],
                });
            },
        });
    }

    setActiveSubregions(subregions: string[]) {
        this.activeSubregions = new Set(subregions);
        if (this.enabled) {
            this.requestRefresh();
        }
    }

    applyFilter(typeKeys: string[]) {
        this.filterKeys = typeKeys;
        if (this.enabled) {
            this.requestRefresh(); // 增量刷新
        } else {
            this.removeClustersFromMap();
        }
    }

    setTemporaryVisibleIds(ids: Iterable<string>) {
        this.temporaryVisibleIds = new Set(ids);
        if (this.enabled) {
            this.requestRefresh();
        }
    }

    setCheckedVisibleOverrideIds(ids: Iterable<string>) {
        this.checkedVisibleOverrideIds = new Set(ids);
        if (this.enabled) {
            this.requestRefresh();
        }
    }

    enable() {
        if (this.enabled) return;
        this.enabled = true;
        this.requestRefresh();
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

        // Get hide completed markers preference
        const shouldHideCompleted = useUiPrefsStore.getState().prefsHideCompletedMarkers;
        const completedMarkerIds = shouldHideCompleted ? new Set(getActivePoints()) : new Set();

        // 仅对当前过滤的、受管理的类型进行增量添加，避免整组重算造成闪烁
        const activeManagedTypes = this.filterKeys.filter((k) => this.clusterGroupsByType[k]);

        activeManagedTypes.forEach((typeKey) => {
            const clusterGroup = this.clusterGroupsByType[typeKey];
            if (!clusterGroup) return;
            const addedIds: string[] = [];

            newIds.forEach((id) => {
                const data = markerDataDict[id];
                if (!data) return;
                if (data.type !== typeKey) return; // 只处理对应类型
                if (!this.activeSubregions.has(data.subregId)) return; // 只处理当前活跃子区域
                if (completedMarkerIds.has(id)) return; // 排除已完成的標點

                const layer = markerDict[id];
                if (!layer) return;
                const parentGroup = layerSubregionDict[data.subregId];
                // 如果原来在父 LayerGroup 中，移除以避免与聚合重复显示
                if (parentGroup?.hasLayer(layer)) {
                    parentGroup.removeLayer(layer);
                }

                clusterGroup.addLayer(layer); // 静默加入，不清空其他
                addedIds.push(id);
            });

            if (clusterGroup.getLayers().length > 0 && !this.deps.map.hasLayer(clusterGroup)) {
                clusterGroup.addTo(this.deps.map);
            }
            if (addedIds.length > 0) {
                this.fadeInVisibleMarkers(clusterGroup, addedIds);
            }
        });
    }

    isEnabled() {
        return this.enabled;
    }

    isTypeManaged(typeKey: string) {
        return Boolean(this.clusterGroupsByType[typeKey]);
    }

    async showMarker(markerId: string): Promise<boolean> {
        if (!this.enabled) return false;

        const markerDict = this.deps.getMarkerDict();
        const markerDataDict = this.deps.getMarkerDataDict();
        const layerSubregionDict = this.deps.getLayerSubregionDict();
        const data = markerDataDict[markerId];
        const layer = markerDict[markerId];
        if (!data || !layer) return false;
        if (!this.activeSubregions.has(data.subregId)) return false;

        const clusterGroup = this.clusterGroupsByType[data.type];
        if (!clusterGroup) return false;

        const parentGroup = layerSubregionDict[data.subregId];
        if (parentGroup?.hasLayer(layer)) {
            parentGroup.removeLayer(layer);
        }

        if (!clusterGroup.hasLayer(layer)) {
            clusterGroup.addLayer(layer);
        }
        if (!this.deps.map.hasLayer(clusterGroup)) {
            clusterGroup.addTo(this.deps.map);
        }

        await new Promise<void>((resolve) => {
            const zoomToShowLayer = (
                clusterGroup as CanvasClusterGroup & {
                    zoomToShowLayer?: (targetLayer: L.Layer, callback: () => void) => void;
                }
            ).zoomToShowLayer;

            if (typeof zoomToShowLayer !== 'function') {
                resolve();
                return;
            }

            let resolved = false;
            const finish = () => {
                if (resolved) return;
                resolved = true;
                resolve();
            };

            window.setTimeout(finish, 1200);
            zoomToShowLayer.call(clusterGroup, layer, finish);
        });

        return true;
    }

    private refreshClusters() {
        if (!this.enabled) return;

        const map = this.deps.map;
        const markerDict = this.deps.getMarkerDict();
        const markerDataDict = this.deps.getMarkerDataDict();
        const markerTypeMap = this.deps.getMarkerTypeMap();
        const layerSubregionDict = this.deps.getLayerSubregionDict();

        // Get hide completed markers preference
        const shouldHideCompleted = useUiPrefsStore.getState().prefsHideCompletedMarkers;
        const completedMarkerIds = shouldHideCompleted ? new Set(getActivePoints()) : new Set();

        const activeManagedTypes = this.filterKeys.filter((key) => this.clusterGroupsByType[key]);

        // 为每个受管理类型做增量 diff
        Object.entries(this.clusterGroupsByType).forEach(([typeKey, clusterGroup]) => {
            const removalWasCancelled = this.cancelPendingRemoval(typeKey, clusterGroup);
            const shouldBeActive = activeManagedTypes.includes(typeKey);

            // 目标集合（需要在聚合中的点位）- 排除已完成的點位
            const desiredIds = (markerTypeMap[typeKey] ?? []).filter((id) => {
                const d = markerDataDict[id];
                const forceVisible = this.checkedVisibleOverrideIds.has(id);
                return d
                    && this.activeSubregions.has(d.subregId)
                    && (!completedMarkerIds.has(id) || forceVisible)
                    && (shouldBeActive || this.temporaryVisibleIds.has(id) || forceVisible);
            });
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

            // 处理新增。先完成聚合计算，再对最终可见的 marker/cluster 播放淡入。
            const layersToAdd: L.Layer[] = [];
            toAdd.forEach((id) => {
                const layer = markerDict[id];
                const data = markerDataDict[id];
                if (!layer || !data) return;
                const parentGroup = layerSubregionDict[data.subregId];
                if (parentGroup?.hasLayer(layer)) {
                    parentGroup.removeLayer(layer);
                }
                layersToAdd.push(layer);
            });
            if (layersToAdd.length > 0) {
                clusterGroup.addLayers(layersToAdd);
            }

            // 如果该类型现在应该展示并且有点位则确保加入地图；否则如果不再需要并且无活动标记则从地图移除
            if ((shouldBeActive || desiredIds.length > 0) && clusterGroup.getLayers().length > 0) {
                if (!map.hasLayer(clusterGroup)) {
                    clusterGroup.addTo(map);
                }
            } else if (!shouldBeActive && desiredIds.length === 0) {
                // 如果处于淡出阶段，等待全部 timer 完成后移除 group；简单策略：无层时立即移除
                if (clusterGroup.getLayers().length === 0 && map.hasLayer(clusterGroup)) {
                    map.removeLayer(clusterGroup);
                }
            }

            if (toRemove.length > 0) {
                this.fadeOutAndRemove(clusterGroup, typeKey, toRemove);
            } else if (toAdd.length > 0 || removalWasCancelled) {
                this.fadeInVisibleMarkers(clusterGroup, desiredIds);
            }
        });
    }

    private getVisibleMarkerInners(clusterGroup: CanvasClusterGroup, markerIds: Iterable<string>) {
        const markerDict = this.deps.getMarkerDict();
        const visibleInners = new Set<HTMLElement>();

        for (const markerId of markerIds) {
            const layer = markerDict[markerId];
            if (!(layer instanceof L.Marker) || !clusterGroup.hasLayer(layer)) continue;

            // Clustered child markers do not own DOM nodes. getVisibleParent resolves either
            // the marker itself or the cluster icon that is actually painted by Leaflet.
            const visibleLayer = clusterGroup.getVisibleParent(layer);
            const markerRoot = visibleLayer?.getElement?.() as HTMLElement | null;
            const inner = markerRoot?.querySelector<HTMLElement>(`.${styles.markerInner}, .${styles.noFrameInner}`);
            if (inner?.isConnected) visibleInners.add(inner);
        }

        return visibleInners;
    }

    private clearVisibleAnimation(clusterGroup: CanvasClusterGroup, markerIds: Iterable<string>) {
        this.getVisibleMarkerInners(clusterGroup, markerIds).forEach((inner) => {
            inner.classList.remove(styles.appearing, styles.disappearing);
        });
    }

    private animateVisibleMarkers(
        clusterGroup: CanvasClusterGroup,
        markerIds: Iterable<string>,
        animationClass: string
    ) {
        if (animationClass === styles.disappearing) {
            this.cancelPendingFadeIn(clusterGroup);
        }
        const visibleInners = [...this.getVisibleMarkerInners(clusterGroup, markerIds)];
        if (visibleInners.length === 0) return;

        visibleInners.forEach((inner) => {
            inner.classList.remove(styles.appearing, styles.disappearing);
        });
        visibleInners.forEach((inner) => {
            inner.classList.add(animationClass);
        });
    }

    private fadeInVisibleMarkers(clusterGroup: CanvasClusterGroup, markerIds: Iterable<string>) {
        this.cancelPendingFadeIn(clusterGroup);
        const frame = window.requestAnimationFrame(() => {
            this.pendingFadeInFrames.delete(clusterGroup);
            this.animateVisibleMarkers(clusterGroup, markerIds, styles.appearing);
        });
        this.pendingFadeInFrames.set(clusterGroup, frame);
    }

    private cancelPendingFadeIn(clusterGroup: CanvasClusterGroup) {
        const frame = this.pendingFadeInFrames.get(clusterGroup);
        if (frame === undefined) return;
        window.cancelAnimationFrame(frame);
        this.pendingFadeInFrames.delete(clusterGroup);
    }

    private cancelPendingRemoval(typeKey: string, clusterGroup: CanvasClusterGroup) {
        const pending = this.pendingRemovalBatches[typeKey];
        if (!pending) return false;

        window.clearTimeout(pending.timer);
        delete this.pendingRemovalBatches[typeKey];
        this.clearVisibleAnimation(clusterGroup, pending.markerIds);
        return true;
    }

    private fadeOutAndRemove(clusterGroup: CanvasClusterGroup, typeKey: string, markerIds: string[]) {
        this.animateVisibleMarkers(clusterGroup, markerIds, styles.disappearing);
        markerIds.forEach(emitPreviewLeave);

        const pendingMarkerIds = new Set(markerIds);
        const timer = window.setTimeout(() => {
            const pending = this.pendingRemovalBatches[typeKey];
            if (!pending || pending.timer !== timer) return;

            const markerDict = this.deps.getMarkerDict();
            const layersToRemove = [...pending.markerIds]
                .map((id) => markerDict[id])
                .filter((layer): layer is L.Layer => Boolean(layer) && clusterGroup.hasLayer(layer));

            if (layersToRemove.length > 0) {
                clusterGroup.removeLayers(layersToRemove);
            }
            delete this.pendingRemovalBatches[typeKey];

            if (clusterGroup.getLayers().length === 0) {
                if (this.deps.map.hasLayer(clusterGroup)) {
                    this.deps.map.removeLayer(clusterGroup);
                }
                return;
            }

            // Removing a child can replace its visible cluster icon. Fade the updated icon back in
            // so count changes and cluster splits do not snap after the outgoing state disappears.
            const remainingIds = (this.deps.getMarkerTypeMap()[typeKey] ?? []).filter((id) => {
                const layer = markerDict[id];
                return Boolean(layer) && clusterGroup.hasLayer(layer);
            });
            this.fadeInVisibleMarkers(clusterGroup, remainingIds);
        }, MARKER_REMOVAL_DELAY_MS);

        this.pendingRemovalBatches[typeKey] = {
            timer,
            markerIds: pendingMarkerIds
        };
    }

    private removeClustersFromMap() {
        const map = this.deps.map;
        Object.entries(this.clusterGroupsByType).forEach(([typeKey, clusterGroup]) => {
            this.cancelPendingRemoval(typeKey, clusterGroup);
            this.cancelPendingFadeIn(clusterGroup);
            clusterGroup.clearLayers();
            if (map.hasLayer(clusterGroup)) {
                map.removeLayer(clusterGroup);
            }
        });
    }
}
