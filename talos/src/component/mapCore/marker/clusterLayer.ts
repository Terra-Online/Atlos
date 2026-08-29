import {
    buildClusterTree,
    getExpansionZoom,
    getLeafIds,
    visibleAtLevel,
    type ClusterTree,
    type LmcCluster,
} from './lmcGrid';
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
// --- 以下常量与布局算法逐行移植自 leaflet.markercluster@1.5.3
//     src/MarkerCluster.Spiderfier.js（MIT, © Dave Leaver） ---
const SPIDERFY_ANIMATION_MS = 200; // 原版 setTimeout 时长
const SPIDERFY_CIRCLE_FOOT_SEPARATION = 25; // _circleFootSeparation
const SPIDERFY_CIRCLE_START_ANGLE = 0; // _circleStartAngle
const SPIDERFY_SPIRAL_FOOT_SEPARATION = 28; // _spiralFootSeparation
const SPIDERFY_SPIRAL_LENGTH_START = 11; // _spiralLengthStart
const SPIDERFY_SPIRAL_LENGTH_FACTOR = 5; // _spiralLengthFactor
const SPIDERFY_CIRCLE_SPIRAL_SWITCHOVER = 9; // _circleSpiralSwitchover：>=9 个用螺旋
const SPIDERFY_MIN_LEG_LENGTH = 35; // 原版 legLength 下限
const SPIDERFY_CLUSTER_OPACITY = 0.3; // 展开期间簇图标淡出到 0.3
const SPIDERFY_MARKER_ZINDEX = 1000000; // 原版 setZIndexOffset(1000000)
const SPIDER_LEG_STYLE = { weight: 1.5, color: '#222', opacity: 0.5 }; // spiderLegPolylineOptions 默认值

/** 原版 _generatePointsCircle：周长 = 25*(2+count)，半径 = 周长/2π（下限 35） */
const generatePointsCircle = (count: number, center: Point): Point[] => {
    const circumference = SPIDERFY_CIRCLE_FOOT_SEPARATION * (2 + count);
    const legLength = Math.max(circumference / (Math.PI * 2), SPIDERFY_MIN_LEG_LENGTH);
    const angleStep = (Math.PI * 2) / count;
    // 原版 hack：circle 布局前 center.y += 10
    const adjustedCenterY = center.y + 10;
    const positions: Point[] = [];
    for (let i = 0; i < count; i++) {
        const angle = SPIDERFY_CIRCLE_START_ANGLE + i * angleStep;
        positions.push(
            new Point(
                Math.round(center.x + legLength * Math.cos(angle)),
                Math.round(adjustedCenterY + legLength * Math.sin(angle)),
            ),
        );
    }
    return positions;
};

/** 原版 _generatePointsSpiral（含 i*0.0005 修正项与首位置跳过） */
const generatePointsSpiral = (count: number, center: Point): Point[] => {
    let legLength = SPIDERFY_SPIRAL_LENGTH_START;
    const separation = SPIDERFY_SPIRAL_FOOT_SEPARATION;
    const lengthFactor = SPIDERFY_SPIRAL_LENGTH_FACTOR * Math.PI * 2;
    let angle = 0;
    const positions: Point[] = new Array<Point>(count);

    // 索引越大离簇心越近；跳过首个位置避免压在簇图标下
    for (let i = count; i >= 0; i--) {
        if (i < count) {
            positions[i] = new Point(
                Math.round(center.x + legLength * Math.cos(angle)),
                Math.round(center.y + legLength * Math.sin(angle)),
            );
        }
        angle += separation / legLength + i * 0.0005;
        legLength += lengthFactor / angle;
    }
    return positions;
};

/** 每个受管理类型的聚合运行时状态（替代原 L.MarkerClusterGroup） */
interface TypeClusterRuntime {
    type: IMarkerType;
    iconUrl: string;
    hasSubIcon: boolean;
    subIconUrl: string;
    /** LMC 聚合树（成员变化时整体重建） */
    tree: ClusterTree;
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
        /** 环形排布位置（game latlng；legs 终点、相机跟随的依据） */
        ringLatLng: LatLng;
        /** 该叶子的连接线（markercluster 的 _spiderLeg 等价物） */
        leg?: SVGPathElement;
    }>;
    /** 簇中心（收回动画目标、legs 起点） */
    centerLatLng: LatLng;
    /** 连接线所在的 SVG 容器 */
    svg?: SVGSVGElement;
    /** render 订阅的取消函数（缩放/平移时 legs 跟随相机） */
    unsubscribeRender?: () => void;
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

    /** zoomend 渲染时间戳：同一次缩放动作后紧跟的 moveend 不再重复渲染
     *  （moveend 的非动画渲染会立刻移除 zoomend 刚飞出的元素，吞掉合并动画） */
    private zoomEndRenderedAt = 0;

    private readonly handleViewChange = () => {
        if (!this.enabled) return;
        if (performance.now() - this.zoomEndRenderedAt < 50) return;
        this.renderAllTypes(false);
    };

    /** zoomend：重算并播放聚合分裂/合并动画（Leaflet.markercluster 语义） */
    private readonly handleZoomEnd = () => {
        if (!this.enabled) return;
        this.zoomEndRenderedAt = performance.now();
        this.renderAllTypes(true);
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

        this.clusterGroupsByType[type.key] = {
            type,
            iconUrl,
            hasSubIcon,
            subIconUrl,
            tree: buildClusterTree({ markerIds: [], getLatLng: () => new LatLng(0, 0), radius: MAX_CLUSTER_RADIUS_PX }),
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
        map.on('zoomend', this.handleZoomEnd);
        map.on('moveend', this.handleViewChange);
        map.on('zoomstart', this.handleZoomStart);
        map.on('click', this.handleMapClick);
        this.refreshClusters();
    }

    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        const map = this.deps.map;
        map.off('zoomend', this.handleZoomEnd);
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

    /** marker 当前是否处于 spiderfy 展开状态（filterMarker 等需豁免） */
    isSpiderfiedLeaf(markerId: string): boolean {
        return (
            this.spiderfied?.entries.some((entry) => entry.markerId === markerId) ??
            false
        );
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
        // 与 Leaflet.markercluster 一致：聚合树最深到 disableClusteringAtZoom-1，
        // 视口缩放取 round 后截断到该层级（其 _zoom = Math.round(map zoom)）。
        return Math.max(
            0,
            Math.min(
                Math.round(this.deps.map.getZoom()),
                DISABLE_CLUSTERING_AT_ZOOM - 1,
            ),
        );
    }

    /** 当前视野 bbox（外扩一个聚合半径），game latlng 单位 */
    private getPaddedViewBbox(): { west: number; south: number; east: number; north: number } {
        const map = this.deps.map;
        const size = map.getSize();
        const topLeft = map.containerPointToLatLng(new Point(-MAX_CLUSTER_RADIUS_PX, -MAX_CLUSTER_RADIUS_PX));
        const bottomRight = map.containerPointToLatLng(
            new Point(size.x + MAX_CLUSTER_RADIUS_PX, size.y + MAX_CLUSTER_RADIUS_PX),
        );
        return {
            west: Math.min(topLeft.lng, bottomRight.lng),
            east: Math.max(topLeft.lng, bottomRight.lng),
            south: Math.min(topLeft.lat, bottomRight.lat),
            north: Math.max(topLeft.lat, bottomRight.lat),
        };
    }

    /** 成员变化后整体重建 LMC 聚合树 */
    private rebuildIndex(state: TypeClusterRuntime) {
        const markerDict = this.deps.getMarkerDict();
        const getLatLng = (markerId: string): LatLng => {
            const layer = markerDict[markerId];
            if (layer instanceof CompatMarker) return layer.getLatLng();
            return new LatLng(0, 0);
        };
        state.tree = buildClusterTree({
            markerIds: [...state.managedIds],
            getLatLng,
            radius: MAX_CLUSTER_RADIUS_PX,
        });
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

    private renderAllTypes(animate = false) {
        if (!this.enabled) return;
        Object.entries(this.clusterGroupsByType).forEach(([typeKey, state]) => {
            this.renderType(typeKey, state, animate);
        });
    }

    /** 重算当前 bbox/zoom 的聚合结果，并对聚合 marker / 叶子 marker 做增量 diff */
    private renderType(typeKey: string, state: TypeClusterRuntime, animate = false) {
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

        // 动画快照：diff 前的屏幕位置（叶子 + 聚合簇）
        const prevLeafPoints = new Map<string, Point>();
        const prevClusterPoints = new Map<number, Point>();
        const prevClusterOfMarker = new Map(state.clusterIdByMarkerId);
        if (animate) {
            state.visibleLeafIds.forEach((id) => {
                const layer = markerDict[id];
                if (layer instanceof CompatMarker) {
                    const point = layer.getContainerPoint();
                    if (point) prevLeafPoints.set(id, point);
                }
            });
            state.clusterMarkers.forEach((marker, clusterId) => {
                const point = marker.getContainerPoint();
                if (point) prevClusterPoints.set(clusterId, point);
            });
        }

        // LMC 语义：zoom >= 2 全部叶子（disableClusteringAtZoom）；否则显示
        // min(round(视口zoom), 1) 层级的聚合树节点。
        const rawZoom = this.deps.map.getZoom();
        const nextClusterIds = new Set<number>();
        const nextClusterIdByMarkerId = new Map<string, number>();
        const nextLeafIds = new Set<string>();

        {
            const bbox = this.getPaddedViewBbox();
            const inBounds = (latlng: LatLng) =>
                latlng.lng >= bbox.west &&
                latlng.lng <= bbox.east &&
                latlng.lat >= bbox.south &&
                latlng.lat <= bbox.north;

            if (rawZoom >= DISABLE_CLUSTERING_AT_ZOOM) {
                state.managedIds.forEach((id) => nextLeafIds.add(id));
            } else {
                const { clusters, leafIds } = visibleAtLevel(state.tree, this.getClusterZoom());
                clusters.forEach((cluster) => {
                    if (!inBounds(cluster.wLatLng)) return;
                    nextClusterIds.add(cluster.id);
                    const count = cluster.childCount;

                    let clusterMarker = state.clusterMarkers.get(cluster.id);
                    if (!clusterMarker) {
                        clusterMarker = this.createClusterMarker(typeKey, state, cluster.id, count, cluster.wLatLng);
                        state.clusterMarkers.set(cluster.id, clusterMarker);
                    } else {
                        clusterMarker.setLatLng(cluster.wLatLng);
                        this.updateClusterCount(state, cluster.id, clusterMarker, count);
                    }
                    if (!state.group.hasLayer(clusterMarker)) {
                        state.group.addLayer(clusterMarker);
                    }
                    // 簇保持可见：作废其可能待决的飞出移除
                    this.cancelRetire(clusterMarker);

                    // 记录叶子归属（getVisibleParent 等价物用）
                    getLeafIds(cluster).forEach((leafId) => {
                        nextClusterIdByMarkerId.set(leafId, cluster.id);
                    });
                });
                leafIds.forEach((id) => nextLeafIds.add(id));
            }
        }

        // 移除不再存在的聚合 marker
        const removedClusterMarkers: Array<{ clusterId: number; marker: CompatMarker }> = [];
        state.clusterMarkers.forEach((marker, clusterId) => {
            if (nextClusterIds.has(clusterId)) return;
            removedClusterMarkers.push({ clusterId, marker });
            state.clusterMarkers.delete(clusterId);
            state.clusterCounts.delete(clusterId);
        });

        // 叶子 diff：不再是叶子的从父组移除；新叶子加回其 subregion 父组。
        // 移除候选 = 已跟踪叶子 ∪ 该类型实际还挂在父组上的 marker
        // （聚合开关切换等时刻有未跟踪的挂载，markerLayer 不再抢先移除）。
        const removedLeafIds: string[] = [];
        state.visibleLeafIds.forEach((id) => {
            if (nextLeafIds.has(id)) return;
            removedLeafIds.push(id);
        });
        const markerTypeMap = this.deps.getMarkerTypeMap();
        (markerTypeMap[typeKey] ?? []).forEach((id) => {
            if (nextLeafIds.has(id)) return;
            const layer = markerDict[id];
            const data = markerDataDict[id];
            const parentGroup = data ? layerSubregionDict[data.subregId] : undefined;
            if (
                layer &&
                parentGroup?.hasLayer(layer) &&
                !removedLeafIds.includes(id) &&
                !this.isSpiderfiedLeaf(id)
            ) {
                removedLeafIds.push(id);
            }
        });

        // 新簇若接收了飞入成员，保持在最终位置淡入（不再从质心滑动）——
        // 视觉重心由飞入的子元素承担（markercluster 合并语义）。
        let absorbedClusterIds = new Set<number>();
        if (animate && (removedClusterMarkers.length > 0 || removedLeafIds.length > 0)) {
            absorbedClusterIds = this.flyOutRemoved(state, removedClusterMarkers, removedLeafIds, nextClusterIdByMarkerId);
        } else {
            removedClusterMarkers.forEach(({ marker }) => state.group.removeLayer(marker));
            removedLeafIds.forEach((id) => {
                const layer = markerDict[id];
                const data = markerDataDict[id];
                const parentGroup = data ? layerSubregionDict[data.subregId] : undefined;
                if (layer && parentGroup?.hasLayer(layer)) {
                    parentGroup.removeLayer(layer);
                }
            });
        }
        nextLeafIds.forEach((id) => {
            const layer = markerDict[id];
            const data = markerDataDict[id];
            if (!layer || !data) return;
            const parentGroup = layerSubregionDict[data.subregId];
            // 不依赖 visibleLeafIds 判断：filterMarker 可能已同步清空父组，这里幂等补回
            if (!(layer instanceof CompatMarker)) return;
            // 叶子重新可见：作废其待决的飞出移除，并清掉可能残留的淡出 class
            this.cancelRetire(layer);
            this.clearDisappearing(layer);
            if (parentGroup && !parentGroup.hasLayer(layer)) {
                parentGroup.addLayer(layer);
            }
        });

        state.clusterIdByMarkerId = nextClusterIdByMarkerId;
        state.visibleLeafIds = nextLeafIds;

        if (animate) {
            this.playMorphAnimations(state, nextClusterIds, nextLeafIds, {
                prevLeafPoints,
                prevClusterPoints,
                prevClusterOfMarker,
            }, absorbedClusterIds);
        }
    }

    /**
     * 合并动画：被吸收的簇/叶子飞入其新归属簇的位置并淡出，动画结束后移除。
     * 返回接收了飞入成员的簇 id 集合（这些簇在最终位置淡入，不再滑动）。
     */
    /** 延迟移除令牌：marker 每次重新挂载/重新动画都会使旧令牌失效，
     *  杜绝快速连续缩放时旧定时器误删已恢复的可见点位。 */
    private retireTokens = new WeakMap<CompatMarker, number>();

    private scheduleRetire(marker: CompatMarker, removeFn: () => void) {
        const token = (this.retireTokens.get(marker) ?? 0) + 1;
        this.retireTokens.set(marker, token);
        window.setTimeout(() => {
            if (this.retireTokens.get(marker) === token) removeFn();
        }, MARKER_FADE_DURATION_MS + 160);
    }

    private cancelRetire(marker: CompatMarker) {
        this.retireTokens.set(marker, (this.retireTokens.get(marker) ?? 0) + 1);
    }

    private clearDisappearing(marker: CompatMarker) {
        const inner = marker.getElement().querySelector<HTMLElement>(
            `.${styles.markerInner}, .${styles.noFrameInner}`,
        );
        inner?.classList.remove(styles.disappearing, styles.appearing);
    }

    private flyOutRemoved(
        state: TypeClusterRuntime,
        removedClusterMarkers: Array<{ clusterId: number; marker: CompatMarker }>,
        removedLeafIds: string[],
        nextClusterIdByMarkerId: Map<string, number>,
    ): Set<number> {
        const absorbedClusterIds = new Set<number>();
        const markerDict = this.deps.getMarkerDict();
        const markerDataDict = this.deps.getMarkerDataDict();
        const layerSubregionDict = this.deps.getLayerSubregionDict();

        const absorbingPoint = (clusterId: number | undefined): Point | undefined => {
            if (clusterId === undefined) return undefined;
            const marker = state.clusterMarkers.get(clusterId);
            return marker?.getContainerPoint() ?? undefined;
        };

        const fadeOut = (marker: CompatMarker) => {
            const inner = marker.getElement().querySelector<HTMLElement>(
                `.${styles.markerInner}, .${styles.noFrameInner}`,
            );
            inner?.classList.add(styles.disappearing);
        };

        // 被吸收的簇：任一成员的新归属簇即合并目标；找不到（视口外等）原地淡出
        removedClusterMarkers.forEach(({ clusterId, marker }) => {
            let target: Point | undefined;
            let absorbingId: number | undefined;
            const cluster = state.tree.byId.get(clusterId);
            const leaves = cluster ? getLeafIds(cluster) : [];
            for (const memberId of leaves) {
                const ownerId = nextClusterIdByMarkerId.get(memberId);
                const point = absorbingPoint(ownerId);
                if (point) {
                    target = point;
                    absorbingId = ownerId;
                    break;
                }
            }

            fadeOut(marker);
            if (target) {
                marker.animatePositionTo(target);
                if (absorbingId !== undefined) absorbedClusterIds.add(absorbingId);
            }
            this.scheduleRetire(marker, () => {
                if (state.group.hasLayer(marker)) state.group.removeLayer(marker);
            });
        });

        // 被吸收的叶子：飞入新归属簇
        removedLeafIds.forEach((id) => {
            const layer = markerDict[id];
            const data = markerDataDict[id];
            if (!(layer instanceof CompatMarker)) return;
            const parentGroup = data ? layerSubregionDict[data.subregId] : undefined;
            const absorbingId = nextClusterIdByMarkerId.get(id);
            const target = absorbingPoint(absorbingId);
            if (target) {
                fadeOut(layer);
                layer.animatePositionTo(target);
                if (absorbingId !== undefined) absorbedClusterIds.add(absorbingId);
                this.scheduleRetire(layer, () => {
                    if (parentGroup?.hasLayer(layer)) parentGroup.removeLayer(layer);
                });
            } else if (parentGroup?.hasLayer(layer)) {
                parentGroup.removeLayer(layer);
            }
        });

        return absorbedClusterIds;
    }

    /** zoomend 后的聚合形态动画（markercluster 分裂/合并语义）：
     *  持续存在的簇从旧位置滑到新位置；新簇从成员旧位置质心聚合而来；
     *  新展开的叶子从旧簇位置飞出。 */
    private playMorphAnimations(
        state: TypeClusterRuntime,
        nextClusterIds: Set<number>,
        nextLeafIds: Set<string>,
        prev: {
            prevLeafPoints: Map<string, Point>;
            prevClusterPoints: Map<number, Point>;
            prevClusterOfMarker: Map<string, number>;
        },
        absorbedClusterIds: Set<number>,
    ) {
        const markerDict = this.deps.getMarkerDict();
        const { prevLeafPoints, prevClusterPoints, prevClusterOfMarker } = prev;

        nextClusterIds.forEach((clusterId) => {
            const clusterMarker = state.clusterMarkers.get(clusterId);
            if (!clusterMarker) return;

            const sameClusterPrev = prevClusterPoints.get(clusterId);
            if (sameClusterPrev && !absorbedClusterIds.has(clusterId)) {
                clusterMarker.animatePositionFrom(sameClusterPrev);
                return;
            }

            if (absorbedClusterIds.has(clusterId)) {
                // 合并目标簇：钉在最终位置，淡入交给飞入的子元素
                const inner = clusterMarker.getElement().querySelector<HTMLElement>(
                    `.${styles.markerInner}, .${styles.noFrameInner}`,
                );
                inner?.classList.add(styles.appearing);
                const clearAppearing = (event: AnimationEvent) => {
                    if (event.target !== inner) return;
                    inner?.classList.remove(styles.appearing);
                    inner?.removeEventListener('animationend', clearAppearing);
                };
                inner?.addEventListener('animationend', clearAppearing);
                return;
            }

            // 新簇：从成员旧位置的质心聚合
            const cluster = state.tree.byId.get(clusterId);
            const leaves = cluster ? getLeafIds(cluster) : [];
            const memberPoints: Point[] = [];
            leaves.forEach((leafId) => {
                const prevLeaf = prevLeafPoints.get(leafId);
                if (prevLeaf) {
                    memberPoints.push(prevLeaf);
                    return;
                }
                const prevClusterId = prevClusterOfMarker.get(leafId);
                const prevClusterPoint =
                    prevClusterId !== undefined
                        ? prevClusterPoints.get(prevClusterId)
                        : undefined;
                if (prevClusterPoint) memberPoints.push(prevClusterPoint);
            });
            if (memberPoints.length === 0) return;
            const centroid = new Point(
                memberPoints.reduce((sum, p) => sum + p.x, 0) / memberPoints.length,
                memberPoints.reduce((sum, p) => sum + p.y, 0) / memberPoints.length,
            );
            clusterMarker.animatePositionFrom(centroid);
        });

        nextLeafIds.forEach((id) => {
            const layer = markerDict[id];
            if (!(layer instanceof CompatMarker)) return;
            const prevLeaf = prevLeafPoints.get(id);
            if (prevLeaf) {
                layer.animatePositionFrom(prevLeaf);
                return;
            }
            const prevClusterId = prevClusterOfMarker.get(id);
            const prevClusterPoint =
                prevClusterId !== undefined
                    ? prevClusterPoints.get(prevClusterId)
                    : undefined;
            if (prevClusterPoint) {
                layer.animatePositionFrom(prevClusterPoint);
            }
        });
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
        const cluster = state?.tree.byId.get(clusterId);
        if (!state || !clusterMarker || !cluster) return;

        const map = this.deps.map;
        const expansionZoom = getExpansionZoom(cluster);
        // 原版 _zoomOrSpiderfy（本应用配置 disableClusteringAtZoom: 2，聚合树最深
        // 到 level 1）：簇的点位若在整个 level 1 都拆不开 → 点击直接 spiderfy；
        // 只有"下一级就散开"的簇才拉近视角（zoomToBoundsOnClick）。实测参考版
        // 在 zoom 0.5/1.2 点击簇均为直接展开。
        if (expansionZoom > DISABLE_CLUSTERING_AT_ZOOM - 1) {
            this.spiderfyCluster(typeKey, state, clusterId, clusterMarker.getLatLng());
            return;
        }
        map.flyTo(clusterMarker.getLatLng(), expansionZoom, { duration: CLUSTER_FLY_DURATION_S });
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

        const clusterId = clusterFeature.id;
        const expansionZoom = getExpansionZoom(clusterFeature);
        const targetZoom = Math.min(expansionZoom, map.getMaxZoom());
        const clusterLatLng = clusterFeature.wLatLng;

        if (expansionZoom > DISABLE_CLUSTERING_AT_ZOOM - 1 || targetZoom <= map.getZoom()) {
            // 无法在可见聚合层级内拆分（重合/过近）或已到顶 → 直接 spiderfy
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
                    stillClustered.id,
                    stillClustered.wLatLng,
                );
            }
            callback();
        });
    }

    /** 在当前缩放级别下找到包含指定 marker 的顶层聚合；marker 是叶子（可见）时返回 null */
    private findClusterContaining(
        state: TypeClusterRuntime,
        markerId: string,
    ): LmcCluster | null {
        if (state.managedIds.size === 0) return null;
        if (this.deps.map.getZoom() >= DISABLE_CLUSTERING_AT_ZOOM) return null;

        const { clusters, leafIds } = visibleAtLevel(state.tree, this.getClusterZoom());
        if (leafIds.includes(markerId)) return null;
        for (const cluster of clusters) {
            if (getLeafIds(cluster).includes(markerId)) return cluster;
        }
        return null;
    }

    /**
     * 简化 spiderfy：将聚合的叶子 marker 以聚合点为中心环形排布
     * （半径 25px 起步，screen px 通过 containerPointToLatLng 转回 game latlng）。
     */
    /**
     * spiderfy（逐行移植自 leaflet.markercluster 的 Spiderfier）：
     * <9 个用 circle 布局（周长 25·(2+n)，半径下限 35，center.y+10 hack），
     * >=9 个用 spiral 布局；legs 用 stroke-dashoffset 描画动画（CSS transition）。
     */
    private spiderfyCluster(typeKey: string, state: TypeClusterRuntime, clusterId: number, center: LatLng) {
        const map = this.deps.map;
        const markerDict = this.deps.getMarkerDict();
        const markerDataDict = this.deps.getMarkerDataDict();
        const layerSubregionDict = this.deps.getLayerSubregionDict();

        // 原版 guard（Spiderfier.js spiderfy()）：已展开的簇再次点击无效果
        if (
            this.spiderfied?.clusterId === clusterId &&
            this.spiderfied.typeKey === typeKey
        ) {
            return;
        }

        this.unspiderfy();

        const cluster = state.tree.byId.get(clusterId);
        const leafIds = cluster ? getLeafIds(cluster) : [];
        if (leafIds.length === 0) return;

        const centerPoint = map.latLngToContainerPoint(center);
        const positions =
            leafIds.length >= SPIDERFY_CIRCLE_SPIRAL_SWITCHOVER
                ? generatePointsSpiral(leafIds.length, centerPoint)
                : generatePointsCircle(leafIds.length, centerPoint);

        const clusterMarker = state.clusterMarkers.get(clusterId);

        // legs SVG（overlayPane：瓦片之上、marker 之下）
        const overlayPane = map.getPane('overlayPane');
        let svg: SVGSVGElement | undefined;
        if (overlayPane) {
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'marker-cluster-spider-svg');
            svg.style.position = 'absolute';
            svg.style.inset = '0';
            svg.style.width = '100%';
            svg.style.height = '100%';
            svg.style.overflow = 'visible';
            svg.style.pointerEvents = 'none';
            overlayPane.appendChild(svg);
        }

        const entries: SpiderfyState['entries'] = [];

        leafIds.forEach((markerId, leafIndex) => {
            const layer = markerDict[markerId];
            const data = markerDataDict[markerId];
            const position = positions[leafIndex];
            if (!(layer instanceof CompatMarker) || !data || !position) return;

            const parentGroup = layerSubregionDict[data.subregId];
            const ringLatLng = map.containerPointToLatLng(position);

            // leg（原版是 L.Polyline，spiderLegPolylineOptions 默认值）
            let leg: SVGPathElement | undefined;
            if (svg) {
                leg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                leg.setAttribute('class', 'leaflet-cluster-spider-leg');
                leg.setAttribute('stroke', SPIDER_LEG_STYLE.color);
                leg.setAttribute('stroke-width', String(SPIDER_LEG_STYLE.weight));
                leg.setAttribute('fill', 'none');
                leg.setAttribute('stroke-opacity', '0');
                leg.setAttribute(
                    'd',
                    `M ${centerPoint.x} ${centerPoint.y} L ${position.x} ${position.y}`,
                );
                const legLength = leg.getTotalLength() + 0.1;
                leg.style.strokeDasharray = String(legLength);
                leg.style.strokeDashoffset = String(legLength);
                svg.appendChild(leg);
            }

            entries.push({
                markerId,
                marker: layer,
                originalLatLng: layer.getLatLng(),
                ringLatLng,
                leg,
            });

            // 原版：zIndexOffset 提到最高；初始位置钉在簇心，随后 CSS transition 飞出
            layer.getElement().style.zIndex = String(SPIDERFY_MARKER_ZINDEX);
            // 作废该叶子可能待决的飞出移除定时器（上一次缩小时遗留的，
            // 否则 spiderfy 动画播完即被旧定时器移除）
            this.cancelRetire(layer);
            this.clearDisappearing(layer);
            if (parentGroup && !parentGroup.hasLayer(layer)) {
                parentGroup.addLayer(layer);
            }
            layer.setLatLng(ringLatLng);
            layer.animatePositionFrom(centerPoint, SPIDERFY_ANIMATION_MS);
        });

        if (entries.length === 0) {
            svg?.remove();
            return;
        }

        // 原版：簇图标淡出到 0.3（不隐藏）
        if (clusterMarker && state.group.hasLayer(clusterMarker)) {
            clusterMarker.getElement().style.opacity = String(SPIDERFY_CLUSTER_OPACITY);
        }

        this.spiderfied = { typeKey, clusterId, centerLatLng: center, entries, svg };

        // legs 描画动画 + 透明度（force reflow 后触发 CSS transition）
        void svg?.getBoundingClientRect();
        entries.forEach(({ leg }) => {
            if (!leg) return;
            leg.style.strokeDashoffset = '0';
            leg.setAttribute('stroke-opacity', String(SPIDER_LEG_STYLE.opacity));
        });

        // 相机移动时 legs 跟随（叶子 latlng 已替换为环形位置，随渲染循环移动）
        this.spiderfied.unsubscribeRender = map.onRender(() => {
            const current = this.spiderfied;
            if (!current) return;
            const centerNow = map.latLngToContainerPoint(current.centerLatLng);
            current.entries.forEach(({ leg, ringLatLng }) => {
                if (!leg) return;
                const end = map.latLngToContainerPoint(ringLatLng);
                leg.setAttribute('d', `M ${centerNow.x} ${centerNow.y} L ${end.x} ${end.y}`);
            });
        });
    }

    /** 取消 spiderfy（逐行移植 _animationUnspiderfy）：叶子收回簇心、legs 反描画、
     *  200ms 后恢复原位；仅剩 <=1 个子点时保留其在地图上。 */
    private unspiderfy() {
        const current = this.spiderfied;
        if (!current) return;
        this.spiderfied = null;

        current.unsubscribeRender?.();

        const map = this.deps.map;
        const markerDataDict = this.deps.getMarkerDataDict();
        const layerSubregionDict = this.deps.getLayerSubregionDict();
        const centerPoint = map.latLngToContainerPoint(current.centerLatLng);

        // 簇图标恢复不透明
        const state = this.clusterGroupsByType[current.typeKey];
        const clusterMarker = state?.clusterMarkers.get(current.clusterId);
        if (clusterMarker) {
            clusterMarker.getElement().style.opacity = '1';
        }

        // 叶子飞回簇心 + legs 反描画（stroke-dashoffset 回到全长 + 淡出）
        current.entries.forEach(({ marker, leg }) => {
            marker.animatePositionTo(centerPoint, SPIDERFY_ANIMATION_MS);
            if (leg) {
                const legLength = leg.getTotalLength() + 0.1;
                leg.style.strokeDashoffset = String(legLength);
                leg.setAttribute('stroke-opacity', '0');
            }
        });
        if (current.svg) {
            const svg = current.svg;
            window.setTimeout(() => svg.remove(), SPIDERFY_ANIMATION_MS + 60);
        }

        window.setTimeout(() => {
            const keepOnMap = current.entries.length <= 1;
            current.entries.forEach(({ markerId, marker, originalLatLng }) => {
                // 该 marker 已进入新的 spiderfy：跳过恢复（旧 spiderfy 的延迟
                // 恢复若落在新 spiderfy 挂载之后，会把新展开的点从 DOM 移除）
                if (this.spiderfied?.entries.some((e) => e.markerId === markerId)) {
                    return;
                }
                marker.getElement().style.zIndex = '';
                marker.setLatLng(originalLatLng);
                const data = markerDataDict[markerId];
                const parentGroup = data ? layerSubregionDict[data.subregId] : undefined;
                if (!keepOnMap && parentGroup?.hasLayer(marker)) {
                    parentGroup.removeLayer(marker);
                }
            });

            if (state) {
                this.renderType(current.typeKey, state);
            }
        }, SPIDERFY_ANIMATION_MS + 60);
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
            this.rebuildIndex(state);
            if (map.hasLayer(state.group)) {
                map.removeLayer(state.group);
            }
        });
    }
}
