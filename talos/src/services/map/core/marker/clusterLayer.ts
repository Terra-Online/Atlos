import L from 'leaflet';
import { createCanvasAwareClusterGroup } from '@/services/map/core/canvas/canvasMarkerCluster';
import type { CanvasClusterGroup } from '@/services/map/core/canvas/clusterGroup';
import { IMarkerData, IMarkerType } from '@/data/marker';
import { getItemIconUrl, getMarkerSubIconUrl } from '@/services/assets/resource';
import { SceneIcon, setMarkerState } from '@/services/map/core/canvas/markerModel';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { getDisplayedPointProgress } from '@/store/guideProgress';
import { emitPreviewLeave } from '@/services/map/core/marker/markerRenderer';

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

const sameIds = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => {
    if (a.size !== b.size) return false;
    for (const id of b) if (!a.has(id)) return false;
    return true;
};

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

    private batchDepth = 0;
    private refreshPending = false;

    constructor(private readonly deps: ClusterLayerDeps) {}

    destroy() {
        this.enabled = false;
        this.clearMarkers();
    }

    clearMarkers() {
        for (const [key, group] of Object.entries(this.clusterGroupsByType)) {
            this.cancelPendingRemoval(key, group);
            group.remove();
            group.clearLayers();
        }
    }

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
        const subIconUrl = !type.noFrame && hasSubIcon && type.subIcon ? getMarkerSubIconUrl(type.subIcon) : '';

        this.clusterGroupsByType[type.key] = createCanvasAwareClusterGroup(this.deps.map, {
            expandOnClick: true,
            disableClusteringAtZoom: 2,
            maxClusterRadius: 60,
            iconCreateFunction: (cluster) => {
                const count = cluster.getChildCount();

                return new SceneIcon({ image: iconUrl, subImage: subIconUrl,
                    noFrame: Boolean(type.noFrame), tier: '', count: String(count) }, type.key);
            },
        });
    }

    setActiveSubregions(subregions: string[]) {
        const next = new Set(subregions);
        if (sameIds(this.activeSubregions, next)) return;
        this.activeSubregions = next;
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
        const next = new Set(ids);
        if (sameIds(this.temporaryVisibleIds, next)) return;
        this.temporaryVisibleIds = next;
        if (this.enabled) {
            this.requestRefresh();
        }
    }

    setCheckedVisibleOverrideIds(ids: Iterable<string>) {
        const next = new Set(ids);
        if (sameIds(this.checkedVisibleOverrideIds, next)) return;
        this.checkedVisibleOverrideIds = next;
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
        const completedMarkerIds = shouldHideCompleted ? new Set(getDisplayedPointProgress()) : new Set();

        const activeManagedTypes = new Set(this.filterKeys.filter((key) => this.clusterGroupsByType[key]));
        const idsByType = new Map<string, string[]>();
        // Region imports contain every new point. Partition once instead of
        // rescanning that whole batch for each active marker type.
        for (const id of newIds) {
            const data = markerDataDict[id];
            if (!data || !activeManagedTypes.has(data.type)
                || !this.activeSubregions.has(data.subregId) || completedMarkerIds.has(id)) continue;
            let ids = idsByType.get(data.type);
            if (!ids) idsByType.set(data.type, ids = []);
            ids.push(id);
        }

        for (const typeKey of activeManagedTypes) {
            const clusterGroup = this.clusterGroupsByType[typeKey];
            const addedIds: string[] = [];
            const ids = idsByType.get(typeKey);
            const retained = ids?.length ? new Set(clusterGroup.getVisibleLayers()) : undefined;
            const layersToAdd: L.Layer[] = [];

            for (const id of ids ?? []) {
                const data = markerDataDict[id];
                const layer = markerDict[id];
                if (!layer) continue;
                const parentGroup = layerSubregionDict[data.subregId];
                if (parentGroup?.hasLayer(layer)) parentGroup.removeLayer(layer);
                layersToAdd.push(layer);
                addedIds.push(id);
            }

            if (layersToAdd.length > 0) clusterGroup.addLayers(layersToAdd);
            if (clusterGroup.getLayers().length > 0 && !this.deps.map.hasLayer(clusterGroup)) {
                clusterGroup.addTo(this.deps.map);
            }
            if (addedIds.length > 0) this.animateVisibleMarkers(clusterGroup, addedIds, 'appearing', retained);
        }
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

        await new Promise<void>((resolve) => clusterGroup.zoomToShowLayer(layer, resolve));

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
        const completedMarkerIds = shouldHideCompleted ? new Set(getDisplayedPointProgress()) : new Set();

        const activeManagedTypes = new Set(this.filterKeys.filter((key) => this.clusterGroupsByType[key]));

        Object.entries(this.clusterGroupsByType).forEach(([typeKey, clusterGroup]) => {
            const removalWasCancelled = this.cancelPendingRemoval(typeKey, clusterGroup);
            const shouldBeActive = activeManagedTypes.has(typeKey);
            const desiredIds: string[] = [], toAdd: string[] = [], toRemove: string[] = [];
            // The type index is authoritative for both membership and desired
            // visibility. Classify each point once; no second set/index is needed.
            for (const id of markerTypeMap[typeKey] ?? []) {
                const data = markerDataDict[id], layer = markerDict[id];
                const current = Boolean(layer) && clusterGroup.hasLayer(layer);
                const forceVisible = this.checkedVisibleOverrideIds.has(id);
                const desired = data && this.activeSubregions.has(data.subregId)
                    && (!completedMarkerIds.has(id) || forceVisible)
                    && (shouldBeActive || this.temporaryVisibleIds.has(id) || forceVisible);
                if (desired) {
                    desiredIds.push(id);
                    if (!current) toAdd.push(id);
                } else if (current) toRemove.push(id);
            }
            const retained = !removalWasCancelled && toAdd.length > 0
                ? new Set(clusterGroup.getVisibleLayers()) : undefined;

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
                this.animateVisibleMarkers(clusterGroup, desiredIds, 'appearing', retained);
            }
        });
    }

    private getVisibleMarkers(clusterGroup: CanvasClusterGroup, markerIds: Iterable<string>, retained?: ReadonlySet<L.Marker>) {
        const markerDict = this.deps.getMarkerDict();
        const visible = new Set<L.Marker>();
        for (const markerId of markerIds) {
            const layer = markerDict[markerId];
            if (!(layer instanceof L.Marker) || !clusterGroup.hasLayer(layer)) continue;
            const parent = clusterGroup.getVisibleParent(layer);
            if (parent && !retained?.has(parent) && this.deps.map.hasLayer(parent)) visible.add(parent);
        }
        return visible;
    }

    private clearVisibleAnimation(clusterGroup: CanvasClusterGroup, markerIds: Iterable<string>) {
        this.getVisibleMarkers(clusterGroup, markerIds).forEach(marker => {
            setMarkerState(marker, { appearing: false, disappearing: false });
        });
    }

    private animateVisibleMarkers(
        clusterGroup: CanvasClusterGroup,
        markerIds: Iterable<string>,
        animation: 'appearing' | 'disappearing',
        retained?: ReadonlySet<L.Marker>,
    ) {
        // Reconciliation is synchronous: publish the fade before the first paint.
        this.getVisibleMarkers(clusterGroup, markerIds, retained).forEach(marker => {
            setMarkerState(marker, { appearing: animation === 'appearing', disappearing: animation === 'disappearing' });
        });
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
        this.animateVisibleMarkers(clusterGroup, markerIds, 'disappearing');
        markerIds.forEach(emitPreviewLeave);

        const pendingMarkerIds = new Set(markerIds);
        const timer = window.setTimeout(() => {
            const pending = this.pendingRemovalBatches[typeKey];
            if (!pending || pending.timer !== timer) return;

            const markerDict = this.deps.getMarkerDict();
            const retained = new Set(clusterGroup.getVisibleLayers());
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
            this.animateVisibleMarkers(clusterGroup, remainingIds, 'appearing', retained);
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
            clusterGroup.clearLayers();
            if (map.hasLayer(clusterGroup)) {
                map.removeLayer(clusterGroup);
            }
        });
    }
}
