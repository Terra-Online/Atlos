import Supercluster from 'supercluster';
import {
    CompatLayer,
    CompatLayerGroup,
    CompatMarker,
    LatLng,
    Point,
    TalosMap,
    divIcon,
    layerGroup,
} from '@/component/mapCore/engine';
import { IMarkerData, IMarkerType } from '@/data/marker';
import { getItemIconUrl, getMarkerSubIconUrl } from '@/utils/resource';
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

/** 与原 markercluster 配置一致：game zoom >= 2 时不再聚合（disableClusteringAtZoom: 2） */
const DISABLE_CLUSTERING_AT_ZOOM = 2;
/** 与原 maxClusterRadius: 60 一致（屏幕像素） */
const MAX_CLUSTER_RADIUS_PX = 60;
/** 聚合点击展开 / zoomToShowLayer 的 flyTo 时长（秒） */
const CLUSTER_FLY_DURATION_S = 0.3;
/** zoomToShowLayer 的兜底超时（与原 1200ms 一致） */
const ZOOM_TO_SHOW_TIMEOUT_MS = 1200;
/** spiderfy 环形排布半径（屏幕像素，25px 起步） */
const SPIDERFY_BASE_RADIUS_PX = 25;
/** spiderfy 相邻 marker 的目标弧长间距（屏幕像素） */
const SPIDERFY_LEAF_SPACING_PX = 28;

/**
 * supercluster 内部按墨卡托经纬度工作，且 v9 会把归一化坐标量化为 Int32。
 * game lat/lng 是 CRS.Simple 数值（量级远超常规角度），直接喂食会被墨卡托
 * latY 截断/缠绕。这里把 game 单位等比缩放到原点附近的小角度区间：
 * 小角度下墨卡托近似线性（聚合半径各向同性），Int32 量化误差 < 0.001 game 单位。
 */
const SUPERCLUSTER_DEG_PER_GAME_UNIT = 360 / 2 ** 20;
/**
 * 半径换算：屏幕 px = game 单位 * 2^zoom，supercluster 归一化半径 = radius / (extent * 2^zoom)，
 * 两者随 zoom 同步缩放，因此 radius = 60 * extent * 缩放比 / 360 即可保持 60 屏幕 px 语义。
 */
const SUPERCLUSTER_RADIUS = (MAX_CLUSTER_RADIUS_PX * 512 * SUPERCLUSTER_DEG_PER_GAME_UNIT) / 360;
/** supercluster 索引的最大聚合层级（保持默认 16；>=2 的缩放级别由渲染层直接展示叶子） */
const SUPERCLUSTER_MAX_ZOOM = 16;
/** 全量 bbox（喂食坐标已缩放到原点附近，该范围必然覆盖全部点位） */
const WORLD_BBOX: [number, number, number, number] = [-180, -90, 180, 90];

type ManagedPointProps = { markerId: string };

/** supercluster 输出的 feature 属性（聚合或叶子） */
interface ManagedFeatureProps {
    markerId?: string;
    cluster?: boolean;
    cluster_id?: number;
    point_count?: number;
}

/** 每个受管理类型的聚合运行时状态（替代原 L.MarkerClusterGroup） */
interface TypeClusterRuntime {
    type: IMarkerType;
    iconUrl: string;
    hasSubIcon: boolean;
    subIconUrl: string;
    /** supercluster 聚合索引（索引不可变，成员变化时整体 load 重建） */
    index: Supercluster<ManagedPointProps, Supercluster.AnyProps>;
    /** 当前由聚合管理的 marker id 集合（等价原 clusterGroup.hasLayer） */
    managedIds: Set<string>;
    /** 承载聚合 marker 的图层组（挂载在地图上） */
    group: CompatLayerGroup;
    /** clusterId → 聚合 marker */
    clusterMarkers: Map<number, CompatMarker>;
    /** clusterId → 当前渲染的 count（用于增量更新文本） */
    clusterCounts: Map<number, number>;
    /** 当前被聚合的 markerId → clusterId（getVisibleParent 等价物用） */
    clusterIdByMarkerId: Map<string, number>;
    /** 当前作为叶子显示在 subregion 父组中的 marker id */
    visibleLeafIds: Set<string>;
}

/** spiderfy 状态：被环形展开的叶子及其原始位置 */
interface SpiderfyState {
    typeKey: string;
    clusterId: number;
    entries: Array<{
        markerId: string;
        marker: CompatMarker;
        originalLatLng: LatLng;
    }>;
}

interface ClusterLayerDeps {
    map: TalosMap;
    getMarkerDict: () => Record<string, CompatLayer>;
    getMarkerDataDict: () => Record<string, IMarkerData>;
    getMarkerTypeMap: () => Record<string, string[]>;
    getLayerSubregionDict: () => Record<string, CompatLayerGroup>;
}

export class ClusterLayer {
    private readonly clusterGroupsByType: Record<string, TypeClusterRuntime> = {};
    private enabled = false;
    private filterKeys: string[] = [];
    private activeSubregions = new Set<string>();
    private temporaryVisibleIds = new Set<string>();
    private checkedVisibleOverrideIds = new Set<string>();
    private pendingRemovalBatches: Record<string, { timer: number; markerIds: Set<string> }> = {};
    private pendingFadeInFrames = new Map<TypeClusterRuntime, number>();
    private scheduledRenderFrame: number | null = null;
    private spiderfied: SpiderfyState | null = null;

    private readonly handleViewChange = () => {
        if (!this.enabled) return;
        this.renderAllTypes();
    };

    private readonly handleZoomStart = () => {
        // zoom 变化时取消 spiderfy，恢复叶子原位
        this.unspiderfy();
    };

    private readonly handleMapClick = () => {
        // 地图 click 时取消 spiderfy
        this.unspiderfy();
    };

    constructor(private readonly deps: ClusterLayerDeps) {}

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

        const index = new Supercluster<ManagedPointProps, Supercluster.AnyProps>({
            radius: SUPERCLUSTER_RADIUS,
            maxZoom: SUPERCLUSTER_MAX_ZOOM,
        });
        index.load([]);

        this.clusterGroupsByType[type.key] = {
            type,
            iconUrl,
            hasSubIcon,
            subIconUrl,
            index,
            managedIds: new Set(),
            group: layerGroup([], { pane: 'markerPane' }),
            clusterMarkers: new Map(),
            clusterCounts: new Map(),
            clusterIdByMarkerId: new Map(),
            visibleLeafIds: new Set(),
        };
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

    setTemporaryVisibleIds(ids: Iterable<string>) {
        this.temporaryVisibleIds = new Set(ids);
        if (this.enabled) {
            this.refreshClusters();
        }
    }

    setCheckedVisibleOverrideIds(ids: Iterable<string>) {
        this.checkedVisibleOverrideIds = new Set(ids);
        if (this.enabled) {
            this.refreshClusters();
        }
    }

    enable() {
        if (this.enabled) return;
        this.enabled = true;
        const map = this.deps.map;
        map.on('zoomend', this.handleViewChange);
        map.on('moveend', this.handleViewChange);
        map.on('zoomstart', this.handleZoomStart);
        map.on('click', this.handleMapClick);
        this.refreshClusters();
    }

    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        const map = this.deps.map;
        map.off('zoomend', this.handleViewChange);
        map.off('moveend', this.handleViewChange);
        map.off('zoomstart', this.handleZoomStart);
        map.off('click', this.handleMapClick);
        this.unspiderfy();
        this.cancelScheduledRender();
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

        const fadeInRequests: Array<{ state: TypeClusterRuntime; markerIds: string[] }> = [];
        let membershipChanged = false;

        activeManagedTypes.forEach((typeKey) => {
            const state = this.clusterGroupsByType[typeKey];
            if (!state) return;
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

                state.managedIds.add(id); // 静默加入，不清空其他
                addedIds.push(id);
            });

            if (addedIds.length === 0) return;
            membershipChanged = true;
            this.rebuildIndex(state);
            if (state.managedIds.size > 0 && !this.deps.map.hasLayer(state.group)) {
                state.group.addTo(this.deps.map);
            }
            fadeInRequests.push({ state, markerIds: addedIds });
        });

        if (!membershipChanged) return;
        // 先调度渲染，再注册淡入（同一帧内保证渲染先执行，淡入能找到最新 DOM）
        this.scheduleRender();
        fadeInRequests.forEach(({ state, markerIds }) => {
            this.fadeInVisibleMarkers(state, markerIds);
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
        if (!(layer instanceof CompatMarker)) return false;
        if (!this.activeSubregions.has(data.subregId)) return false;

        const state = this.clusterGroupsByType[data.type];
        if (!state) return false;

        const parentGroup = layerSubregionDict[data.subregId];
        if (parentGroup?.hasLayer(layer)) {
            parentGroup.removeLayer(layer);
        }

        if (!state.managedIds.has(markerId)) {
            state.managedIds.add(markerId);
            this.rebuildIndex(state);
        }
        if (!this.deps.map.hasLayer(state.group)) {
            state.group.addTo(this.deps.map);
        }
        // 同步渲染，确保 zoomToShowLayer 的可见性判断与 DOM 一致
        this.renderType(data.type, state);

        await new Promise<void>((resolve) => {
            let resolved = false;
            const finish = () => {
                if (resolved) return;
                resolved = true;
                resolve();
            };

            window.setTimeout(finish, ZOOM_TO_SHOW_TIMEOUT_MS);
            this.zoomToShowLayer(state, markerId, finish);
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

        const fadeInRequests: Array<{ state: TypeClusterRuntime; markerIds: string[] }> = [];

        // 为每个受管理类型做增量 diff
        Object.entries(this.clusterGroupsByType).forEach(([typeKey, state]) => {
            const removalWasCancelled = this.cancelPendingRemoval(typeKey, state);
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
            const currentIds = [...state.managedIds].filter((id) => Boolean(markerDict[id]));
            const currentSet = new Set(currentIds);

            // 计算增量
            const toAdd = desiredIds.filter((id) => !currentSet.has(id));
            const toRemove = currentIds.filter((id) => !desiredSet.has(id));

            // 处理新增。先完成聚合计算，再对最终可见的 marker/cluster 播放淡入。
            let membershipChanged = false;
            toAdd.forEach((id) => {
                const layer = markerDict[id];
                const data = markerDataDict[id];
                if (!layer || !data) return;
                const parentGroup = layerSubregionDict[data.subregId];
                if (parentGroup?.hasLayer(layer)) {
                    parentGroup.removeLayer(layer);
                }
                state.managedIds.add(id);
                membershipChanged = true;
            });
            if (membershipChanged) {
                this.rebuildIndex(state);
            }

            // 如果该类型现在应该展示并且有点位则确保加入地图；否则如果不再需要并且无活动标记则从地图移除
            if ((shouldBeActive || desiredIds.length > 0) && state.managedIds.size > 0) {
                if (!map.hasLayer(state.group)) {
                    state.group.addTo(map);
                }
            } else if (!shouldBeActive && desiredIds.length === 0) {
                // 如果处于淡出阶段，等待全部 timer 完成后移除 group；简单策略：无层时立即移除
                if (state.managedIds.size === 0 && map.hasLayer(state.group)) {
                    map.removeLayer(state.group);
                }
            }

            if (toRemove.length > 0) {
                this.fadeOutAndRemove(state, typeKey, toRemove);
            } else if (toAdd.length > 0 || removalWasCancelled) {
                fadeInRequests.push({ state, markerIds: desiredIds });
            }
        });

        // 渲染必须延迟到下一帧：markerLayer 的 filterMarker 会在 applyFilter 之后
        // 同步清空受管理 marker 的父组，同步渲染加回的叶子会被再次移除。
        // 渲染调度在淡入之前注册，保证同一帧内渲染先执行，淡入能找到最新 DOM。
        this.scheduleRender();
        fadeInRequests.forEach(({ state, markerIds }) => {
            this.fadeInVisibleMarkers(state, markerIds);
        });
    }

    /**
     * supercluster 需要的整数 zoom：取 floor（下限 0）。
     * 注意不能用 round——原插件按原始缩放比较 disableClusteringAtZoom(=2)，
     * zoom 1.5 应仍聚合（1.5 < 2），round(1.5)=2 会错误地短路为全叶子。
     */
    private getClusterZoom(): number {
        return Math.max(0, Math.floor(this.deps.map.getZoom()));
    }

    /** 当前视野 bbox（外扩一个聚合半径），换算为 supercluster 喂食坐标 */
    private getPaddedViewBbox(): [number, number, number, number] {
        const map = this.deps.map;
        const size = map.getSize();
        const topLeft = map.containerPointToLatLng(new Point(-MAX_CLUSTER_RADIUS_PX, -MAX_CLUSTER_RADIUS_PX));
        const bottomRight = map.containerPointToLatLng(
            new Point(size.x + MAX_CLUSTER_RADIUS_PX, size.y + MAX_CLUSTER_RADIUS_PX),
        );
        const west = Math.min(topLeft.lng, bottomRight.lng) * SUPERCLUSTER_DEG_PER_GAME_UNIT;
        const east = Math.max(topLeft.lng, bottomRight.lng) * SUPERCLUSTER_DEG_PER_GAME_UNIT;
        const south = Math.min(topLeft.lat, bottomRight.lat) * SUPERCLUSTER_DEG_PER_GAME_UNIT;
        const north = Math.max(topLeft.lat, bottomRight.lat) * SUPERCLUSTER_DEG_PER_GAME_UNIT;
        return [west, south, east, north];
    }

    /** supercluster 喂食坐标 → game latlng */
    private fedCoordinatesToLatLng(coordinates: number[]): LatLng {
        return new LatLng(
            coordinates[1] / SUPERCLUSTER_DEG_PER_GAME_UNIT,
            coordinates[0] / SUPERCLUSTER_DEG_PER_GAME_UNIT,
        );
    }

    /** 成员变化后整体重建 supercluster 索引 */
    private rebuildIndex(state: TypeClusterRuntime) {
        const markerDict = this.deps.getMarkerDict();
        const features: Array<Supercluster.PointFeature<ManagedPointProps>> = [];
        state.managedIds.forEach((id) => {
            const layer = markerDict[id];
            if (!(layer instanceof CompatMarker)) return;
            const { lat, lng } = layer.getLatLng();
            features.push({
                type: 'Feature',
                properties: { markerId: id },
                geometry: {
                    type: 'Point',
                    coordinates: [
                        lng * SUPERCLUSTER_DEG_PER_GAME_UNIT,
                        lat * SUPERCLUSTER_DEG_PER_GAME_UNIT,
                    ],
                },
            });
        });
        state.index.load(features);
    }

    private scheduleRender() {
        if (this.scheduledRenderFrame !== null) return;
        this.scheduledRenderFrame = window.requestAnimationFrame(() => {
            this.scheduledRenderFrame = null;
            this.renderAllTypes();
        });
    }

    private cancelScheduledRender() {
        if (this.scheduledRenderFrame === null) return;
        window.cancelAnimationFrame(this.scheduledRenderFrame);
        this.scheduledRenderFrame = null;
    }

    private renderAllTypes() {
        if (!this.enabled) return;
        Object.entries(this.clusterGroupsByType).forEach(([typeKey, state]) => {
            this.renderType(typeKey, state);
        });
    }

    /** 重算当前 bbox/zoom 的聚合结果，并对聚合 marker / 叶子 marker 做增量 diff */
    private renderType(typeKey: string, state: TypeClusterRuntime) {
        if (!this.enabled) return;
        // spiderfy 期间保持环形排布，不参与重渲染
        if (this.spiderfied?.typeKey === typeKey) return;

        const map = this.deps.map;
        if (state.managedIds.size === 0 || !map.hasLayer(state.group)) {
            this.clearRenderedState(state);
            return;
        }

        const markerDict = this.deps.getMarkerDict();
        const markerDataDict = this.deps.getMarkerDataDict();
        const layerSubregionDict = this.deps.getLayerSubregionDict();

        const zoom = this.getClusterZoom();
        const nextClusterIds = new Set<number>();
        const nextClusterIdByMarkerId = new Map<string, number>();
        const nextLeafIds = new Set<string>();

        if (this.deps.map.getZoom() >= DISABLE_CLUSTERING_AT_ZOOM) {
            // disableClusteringAtZoom: 2 —— game zoom >= 2 时直接展示叶子
            state.managedIds.forEach((id) => nextLeafIds.add(id));
        } else {
            const features = state.index.getClusters(this.getPaddedViewBbox(), zoom);
            features.forEach((feature) => {
                const props = feature.properties as ManagedFeatureProps | null;
                if (!props) return;
                if (props.cluster && props.cluster_id !== undefined) {
                    const clusterId = props.cluster_id;
                    nextClusterIds.add(clusterId);
                    const count = props.point_count ?? 0;
                    const latlng = this.fedCoordinatesToLatLng(feature.geometry.coordinates);

                    let clusterMarker = state.clusterMarkers.get(clusterId);
                    if (!clusterMarker) {
                        clusterMarker = this.createClusterMarker(typeKey, state, clusterId, count, latlng);
                        state.clusterMarkers.set(clusterId, clusterMarker);
                    } else {
                        clusterMarker.setLatLng(latlng);
                        this.updateClusterCount(state, clusterId, clusterMarker, count);
                    }
                    if (!state.group.hasLayer(clusterMarker)) {
                        state.group.addLayer(clusterMarker);
                    }

                    // 记录叶子归属（getVisibleParent 等价物用）
                    const leaves = state.index.getLeaves(clusterId, Number.POSITIVE_INFINITY);
                    leaves.forEach((leaf) => {
                        const leafId = (leaf.properties as ManagedFeatureProps | null)?.markerId;
                        if (leafId) nextClusterIdByMarkerId.set(leafId, clusterId);
                    });
                } else if (props.markerId) {
                    nextLeafIds.add(props.markerId);
                }
            });
        }

        // 移除不再存在的聚合 marker
        state.clusterMarkers.forEach((marker, clusterId) => {
            if (nextClusterIds.has(clusterId)) return;
            state.group.removeLayer(marker);
            state.clusterMarkers.delete(clusterId);
            state.clusterCounts.delete(clusterId);
        });

        // 叶子 diff：不再是叶子的从父组移除；新叶子加回其 subregion 父组
        state.visibleLeafIds.forEach((id) => {
            if (nextLeafIds.has(id)) return;
            const layer = markerDict[id];
            const data = markerDataDict[id];
            const parentGroup = data ? layerSubregionDict[data.subregId] : undefined;
            if (layer && parentGroup?.hasLayer(layer)) {
                parentGroup.removeLayer(layer);
            }
        });
        nextLeafIds.forEach((id) => {
            const layer = markerDict[id];
            const data = markerDataDict[id];
            if (!layer || !data) return;
            const parentGroup = layerSubregionDict[data.subregId];
            // 不依赖 visibleLeafIds 判断：filterMarker 可能已同步清空父组，这里幂等补回
            if (parentGroup && !parentGroup.hasLayer(layer)) {
                parentGroup.addLayer(layer);
            }
        });

        state.clusterIdByMarkerId = nextClusterIdByMarkerId;
        state.visibleLeafIds = nextLeafIds;
    }

    private clearRenderedState(state: TypeClusterRuntime) {
        const markerDict = this.deps.getMarkerDict();
        const markerDataDict = this.deps.getMarkerDataDict();
        const layerSubregionDict = this.deps.getLayerSubregionDict();

        state.clusterMarkers.forEach((marker) => state.group.removeLayer(marker));
        state.clusterMarkers.clear();
        state.clusterCounts.clear();
        state.clusterIdByMarkerId.clear();
        state.visibleLeafIds.forEach((id) => {
            const layer = markerDict[id];
            const data = markerDataDict[id];
            const parentGroup = data ? layerSubregionDict[data.subregId] : undefined;
            if (layer && parentGroup?.hasLayer(layer)) {
                parentGroup.removeLayer(layer);
            }
        });
        state.visibleLeafIds.clear();
    }

    /** 聚合图标 html 与原 markercluster iconCreateFunction 完全一致 */
    private createClusterIcon(state: TypeClusterRuntime, count: number) {
        const { type, iconUrl, hasSubIcon, subIconUrl } = state;

        if (type.noFrame) {
            return divIcon({
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
            return divIcon({
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

        return divIcon({
            html: `<div class="${styles.markerInner} ${styles.clusterMarker}">
                      <div class="${styles.FrameImage}" style="background-image: url(${iconUrl})"></div>
                      <span class="${styles.clusterCount}">${count}</span>
                   </div>`,
            className: `${styles.FrameMarkerIcon} marker-cluster-custom`,
            iconSize: [32, 32],
            iconAnchor: [16, 32],
        });
    }

    private createClusterMarker(
        typeKey: string,
        state: TypeClusterRuntime,
        clusterId: number,
        count: number,
        latlng: LatLng,
    ): CompatMarker {
        const marker = new CompatMarker(latlng, {
            icon: this.createClusterIcon(state, count),
        });
        // zoomToBoundsOnClick：点击聚合 → 展开缩放
        marker.on('click', () => this.handleClusterClick(typeKey, clusterId));
        state.clusterCounts.set(clusterId, count);
        return marker;
    }

    /** count 变化时只更新文本，避免重建 DOM 造成闪烁 */
    private updateClusterCount(
        state: TypeClusterRuntime,
        clusterId: number,
        marker: CompatMarker,
        count: number,
    ) {
        if (state.clusterCounts.get(clusterId) === count) return;
        state.clusterCounts.set(clusterId, count);
        const countElement = marker.getElement().querySelector(`.${styles.clusterCount}`);
        if (countElement) countElement.textContent = String(count);
    }

    private handleClusterClick(typeKey: string, clusterId: number) {
        if (!this.enabled) return;
        const state = this.clusterGroupsByType[typeKey];
        const clusterMarker = state?.clusterMarkers.get(clusterId);
        if (!state || !clusterMarker) return;

        const map = this.deps.map;
        const expansionZoom = state.index.getClusterExpansionZoom(clusterId);
        const targetZoom = Math.min(expansionZoom, map.getMaxZoom());
        if (targetZoom <= map.getZoom()) {
            // 已到最大缩放仍无法展开（多点重叠）→ 简化 spiderfy
            this.spiderfyCluster(typeKey, state, clusterId, clusterMarker.getLatLng());
            return;
        }
        map.flyTo(clusterMarker.getLatLng(), targetZoom, { duration: CLUSTER_FLY_DURATION_S });
    }

    /**
     * zoomToShowLayer 等价物：找到包含目标 marker 的顶层聚合，flyTo 到其展开缩放；
     * 若到达最大缩放仍被聚合（多点重叠）则执行简化 spiderfy；marker 可见后调用 callback。
     */
    private zoomToShowLayer(state: TypeClusterRuntime, markerId: string, callback: () => void) {
        const map = this.deps.map;
        const clusterFeature = this.findClusterContaining(state, markerId);
        if (!clusterFeature) {
            // 当前已经是叶子（可见）
            callback();
            return;
        }

        const clusterId = clusterFeature.properties.cluster_id;
        const expansionZoom = state.index.getClusterExpansionZoom(clusterId);
        const targetZoom = Math.min(expansionZoom, map.getMaxZoom());
        const clusterLatLng = this.fedCoordinatesToLatLng(clusterFeature.geometry.coordinates);

        if (targetZoom <= map.getZoom()) {
            // 已处于最大缩放仍被聚合 → 直接 spiderfy
            this.spiderfyCluster(state.type.key, state, clusterId, clusterLatLng);
            callback();
            return;
        }

        map.flyTo(clusterLatLng, targetZoom, { duration: CLUSTER_FLY_DURATION_S });
        map.once('zoomend', () => {
            // flyTo 结束后 zoomend 已触发重渲染；若仍被聚合（max zoom 处多点重叠）→ spiderfy
            const stillClustered = this.findClusterContaining(state, markerId);
            if (stillClustered) {
                this.spiderfyCluster(
                    state.type.key,
                    state,
                    stillClustered.properties.cluster_id,
                    this.fedCoordinatesToLatLng(stillClustered.geometry.coordinates),
                );
            }
            callback();
        });
    }

    /** 在当前缩放级别下找到包含指定 marker 的顶层聚合；marker 是叶子（可见）时返回 null */
    private findClusterContaining(
        state: TypeClusterRuntime,
        markerId: string,
    ): Supercluster.ClusterFeature<Supercluster.AnyProps> | null {
        if (state.managedIds.size === 0) return null;
        const zoom = this.getClusterZoom();
        if (zoom >= DISABLE_CLUSTERING_AT_ZOOM) return null;

        const features = state.index.getClusters(WORLD_BBOX, zoom);
        for (const feature of features) {
            const props = feature.properties as ManagedFeatureProps | null;
            if (!props) continue;
            if (props.cluster && props.cluster_id !== undefined) {
                const leaves = state.index.getLeaves(props.cluster_id, Number.POSITIVE_INFINITY);
                const contains = leaves.some(
                    (leaf) => (leaf.properties as ManagedFeatureProps | null)?.markerId === markerId,
                );
                if (contains) {
                    return feature as Supercluster.ClusterFeature<Supercluster.AnyProps>;
                }
            } else if (props.markerId === markerId) {
                return null;
            }
        }
        return null;
    }

    /**
     * 简化 spiderfy：将聚合的叶子 marker 以聚合点为中心环形排布
     * （半径 25px 起步，screen px 通过 containerPointToLatLng 转回 game latlng）。
     */
    private spiderfyCluster(typeKey: string, state: TypeClusterRuntime, clusterId: number, center: LatLng) {
        const map = this.deps.map;
        const markerDict = this.deps.getMarkerDict();
        const markerDataDict = this.deps.getMarkerDataDict();
        const layerSubregionDict = this.deps.getLayerSubregionDict();

        this.unspiderfy();

        const leaves = state.index.getLeaves(clusterId, Number.POSITIVE_INFINITY);
        if (leaves.length === 0) return;

        const centerPoint = map.latLngToContainerPoint(center);
        const radius = Math.max(
            SPIDERFY_BASE_RADIUS_PX,
            (leaves.length * SPIDERFY_LEAF_SPACING_PX) / (2 * Math.PI),
        );
        const entries: SpiderfyState['entries'] = [];

        leaves.forEach((leaf, leafIndex) => {
            const markerId = (leaf.properties as ManagedFeatureProps | null)?.markerId;
            if (!markerId) return;
            const layer = markerDict[markerId];
            const data = markerDataDict[markerId];
            if (!(layer instanceof CompatMarker) || !data) return;

            const angle = (leafIndex / leaves.length) * Math.PI * 2 - Math.PI / 2;
            const point = new Point(
                centerPoint.x + radius * Math.cos(angle),
                centerPoint.y + radius * Math.sin(angle),
            );
            const latlng = map.containerPointToLatLng(point);
            const parentGroup = layerSubregionDict[data.subregId];

            entries.push({ markerId, marker: layer, originalLatLng: layer.getLatLng() });
            layer.setLatLng(latlng);
            if (parentGroup && !parentGroup.hasLayer(layer)) {
                parentGroup.addLayer(layer);
            }
        });

        if (entries.length === 0) return;

        // 隐藏被展开的聚合 marker（取消 spiderfy 后的重渲染会恢复）
        const clusterMarker = state.clusterMarkers.get(clusterId);
        if (clusterMarker && state.group.hasLayer(clusterMarker)) {
            state.group.removeLayer(clusterMarker);
        }

        this.spiderfied = { typeKey, clusterId, entries };
    }

    /** 取消 spiderfy：恢复叶子原位并重新渲染（地图 click 或 zoom 变化时触发） */
    private unspiderfy() {
        const current = this.spiderfied;
        if (!current) return;
        this.spiderfied = null;

        const markerDataDict = this.deps.getMarkerDataDict();
        const layerSubregionDict = this.deps.getLayerSubregionDict();
        current.entries.forEach(({ markerId, marker, originalLatLng }) => {
            marker.setLatLng(originalLatLng);
            const data = markerDataDict[markerId];
            const parentGroup = data ? layerSubregionDict[data.subregId] : undefined;
            if (parentGroup?.hasLayer(marker)) {
                parentGroup.removeLayer(marker);
            }
        });

        const state = this.clusterGroupsByType[current.typeKey];
        if (state) {
            this.renderType(current.typeKey, state);
        }
    }

    /** getVisibleParent 等价物：被聚合 → 返回其聚合 marker；否则返回自身（供 fade 动画找 DOM） */
    private getVisibleParent(
        state: TypeClusterRuntime,
        markerId: string,
        layer: CompatMarker,
    ): CompatMarker {
        const clusterId = state.clusterIdByMarkerId.get(markerId);
        if (clusterId !== undefined) {
            const clusterMarker = state.clusterMarkers.get(clusterId);
            if (clusterMarker) return clusterMarker;
        }
        return layer;
    }

    private getVisibleMarkerInners(state: TypeClusterRuntime, markerIds: Iterable<string>) {
        const markerDict = this.deps.getMarkerDict();
        const visibleInners = new Set<HTMLElement>();

        for (const markerId of markerIds) {
            const layer = markerDict[markerId];
            if (!(layer instanceof CompatMarker) || !state.managedIds.has(markerId)) continue;

            // 被聚合的 marker 自身没有可见 DOM，使用实际渲染的聚合图标
            const visibleLayer = this.getVisibleParent(state, markerId, layer);
            const markerRoot = visibleLayer.getElement() as HTMLElement | null;
            const inner = markerRoot?.querySelector<HTMLElement>(
                `.${styles.markerInner}, .${styles.noFrameInner}`,
            );
            if (inner) visibleInners.add(inner);
        }

        return visibleInners;
    }

    private clearVisibleAnimation(state: TypeClusterRuntime, markerIds: Iterable<string>) {
        this.getVisibleMarkerInners(state, markerIds).forEach((inner) => {
            inner.classList.remove(styles.appearing, styles.disappearing);
        });
    }

    private animateVisibleMarkers(
        state: TypeClusterRuntime,
        markerIds: Iterable<string>,
        animationClass: string
    ) {
        if (animationClass === styles.disappearing) {
            this.cancelPendingFadeIn(state);
        }
        const visibleInners = [...this.getVisibleMarkerInners(state, markerIds)];
        if (visibleInners.length === 0) return;

        visibleInners.forEach((inner) => {
            inner.classList.remove(styles.appearing, styles.disappearing);
        });
        // Flush once so reapplying the same class restarts the animation after rapid filter changes.
        void visibleInners[0].offsetWidth;
        visibleInners.forEach((inner) => {
            inner.classList.add(animationClass);
            if (animationClass !== styles.appearing) return;

            const clearAppearing = (event: AnimationEvent) => {
                if (event.target !== inner) return;
                inner.classList.remove(styles.appearing);
                inner.removeEventListener('animationend', clearAppearing);
            };
            inner.addEventListener('animationend', clearAppearing);
        });
    }

    private fadeInVisibleMarkers(state: TypeClusterRuntime, markerIds: Iterable<string>) {
        this.cancelPendingFadeIn(state);
        const frame = window.requestAnimationFrame(() => {
            this.pendingFadeInFrames.delete(state);
            this.animateVisibleMarkers(state, markerIds, styles.appearing);
        });
        this.pendingFadeInFrames.set(state, frame);
    }

    private cancelPendingFadeIn(state: TypeClusterRuntime) {
        const frame = this.pendingFadeInFrames.get(state);
        if (frame === undefined) return;
        window.cancelAnimationFrame(frame);
        this.pendingFadeInFrames.delete(state);
    }

    private cancelPendingRemoval(typeKey: string, state: TypeClusterRuntime) {
        const pending = this.pendingRemovalBatches[typeKey];
        if (!pending) return false;

        window.clearTimeout(pending.timer);
        delete this.pendingRemovalBatches[typeKey];
        this.clearVisibleAnimation(state, pending.markerIds);
        return true;
    }

    private fadeOutAndRemove(state: TypeClusterRuntime, typeKey: string, markerIds: string[]) {
        this.animateVisibleMarkers(state, markerIds, styles.disappearing);
        markerIds.forEach(emitPreviewLeave);

        const pendingMarkerIds = new Set(markerIds);
        const timer = window.setTimeout(() => {
            const pending = this.pendingRemovalBatches[typeKey];
            if (!pending || pending.timer !== timer) return;

            pending.markerIds.forEach((id) => {
                state.managedIds.delete(id);
            });
            this.rebuildIndex(state);
            delete this.pendingRemovalBatches[typeKey];

            // 同步渲染，移除已淡出点位对应的聚合/叶子显示
            this.renderType(typeKey, state);

            if (state.managedIds.size === 0) {
                if (this.deps.map.hasLayer(state.group)) {
                    this.deps.map.removeLayer(state.group);
                }
                return;
            }

            // Removing a child can replace its visible cluster icon. Fade the updated icon back in
            // so count changes and cluster splits do not snap after the outgoing state disappears.
            const markerDict = this.deps.getMarkerDict();
            const remainingIds = (this.deps.getMarkerTypeMap()[typeKey] ?? []).filter((id) => {
                return Boolean(markerDict[id]) && state.managedIds.has(id);
            });
            this.fadeInVisibleMarkers(state, remainingIds);
        }, MARKER_REMOVAL_DELAY_MS);

        this.pendingRemovalBatches[typeKey] = {
            timer,
            markerIds: pendingMarkerIds
        };
    }

    private removeClustersFromMap() {
        const map = this.deps.map;
        Object.entries(this.clusterGroupsByType).forEach(([typeKey, state]) => {
            this.cancelPendingRemoval(typeKey, state);
            this.cancelPendingFadeIn(state);
            state.managedIds.clear();
            state.clusterMarkers.forEach((marker) => state.group.removeLayer(marker));
            state.clusterMarkers.clear();
            state.clusterCounts.clear();
            state.clusterIdByMarkerId.clear();
            state.visibleLeafIds.clear();
            state.index.load([]);
            if (map.hasLayer(state.group)) {
                map.removeLayer(state.group);
            }
        });
    }
}
