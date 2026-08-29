/**
 * Leaflet.markercluster 的 DistanceGrid 聚类算法逐行移植
 * （v1.5.3 src/DistanceGrid.js + MarkerClusterGroup._addLayer + MarkerCluster，
 *   MIT © Dave Leaver），替换 supercluster 以获得与原版完全一致的
 *   聚合成员、阈值（60px）与簇位置（加权质心）。
 *
 * 本应用配置对应：maxClusterRadius=60（常量）、disableClusteringAtZoom=2，
 * 因此聚合树只有两级（level 0、level 1），root 位于 minZoom-1=-1。
 */
import { LatLng, Point } from '../engine';

/** 每个类型的聚合树节点（对应原 MarkerCluster） */
export interface LmcCluster {
    id: number;
    /** 层级：-1=root，0、1=聚合层级 */
    zoom: number;
    /** 近邻搜索锚点：第一个子点的位置（原 _cLatLng，之后不再变化） */
    cLatLng: LatLng;
    /** 显示位置：加权质心（原 _wLatLng） */
    wLatLng: LatLng;
    childCount: number;
    /** 直接叶子成员（marker id） */
    markers: string[];
    childClusters: LmcCluster[];
    parent: LmcCluster | null;
}

export interface ClusterTree {
    root: LmcCluster;
    byId: Map<number, LmcCluster>;
}

/** 原版 DistanceGrid：cellSize=radius，近邻搜 3×3 网格取最近 */
class DistanceGrid<T> {
    private readonly cellSize: number;
    private readonly sqCellSize: number;
    private readonly grid: Record<number, Record<number, T[]>> = {};
    private readonly objectPoint = new Map<T, Point>();

    constructor(cellSize: number) {
        this.cellSize = cellSize;
        this.sqCellSize = cellSize * cellSize;
    }

    addObject(obj: T, point: Point) {
        const x = this.getCoord(point.x);
        const y = this.getCoord(point.y);
        const row = (this.grid[y] ??= {});
        const cell = (row[x] ??= []);
        this.objectPoint.set(obj, point);
        cell.push(obj);
    }

    removeObject(obj: T, point: Point) {
        const x = this.getCoord(point.x);
        const y = this.getCoord(point.y);
        const cell = this.grid[y]?.[x];
        if (!cell) return;
        this.objectPoint.delete(obj);
        const index = cell.indexOf(obj);
        if (index >= 0) cell.splice(index, 1);
    }

    /** 原版 getNearObject：3×3 邻域内 sqDist < radius² 的最近对象 */
    getNearObject(point: Point): T | null {
        const x = this.getCoord(point.x);
        const y = this.getCoord(point.y);
        let closestDistSq = this.sqCellSize;
        let closest: T | null = null;

        for (let i = y - 1; i <= y + 1; i++) {
            const row = this.grid[i];
            if (!row) continue;
            for (let j = x - 1; j <= x + 1; j++) {
                const cell = row[j];
                if (!cell) continue;
                for (const obj of cell) {
                    const objectPoint = this.objectPoint.get(obj);
                    if (!objectPoint) continue;
                    const dist = sqDist(objectPoint, point);
                    if (dist < closestDistSq || (dist <= closestDistSq && closest === null)) {
                        closestDistSq = dist;
                        closest = obj;
                    }
                }
            }
        }
        return closest;
    }

    private getCoord(x: number): number {
        const coord = Math.floor(x / this.cellSize);
        return Number.isFinite(coord) ? coord : x;
    }
}

const sqDist = (a: Point, b: Point): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return dx * dx + dy * dy;
};

/** CRS.Simple project（game 单位）：zoom 级像素坐标 */
const projectAtZoom = (latlng: LatLng, zoom: number): Point =>
    new Point(latlng.lng * 2 ** zoom, -latlng.lat * 2 ** zoom);

export const LMC_ROOT_ZOOM = -1;

/**
 * 原版 MarkerClusterGroup._addLayer 的建树过程：
 * 每个 marker 从 maxZoom 向下逐层尝试——先找近邻簇加入，找不到则与近邻
 * 单点合成新簇并向上补中间父簇，都不沾则记录为该层未聚合点。
 */
export const buildClusterTree = (options: {
    markerIds: string[];
    getLatLng: (markerId: string) => LatLng;
    radius: number;
    minZoom?: number;
    maxZoom?: number;
}): ClusterTree => {
    const { markerIds, getLatLng, radius } = options;
    const minZoom = options.minZoom ?? 0;
    const maxZoom = options.maxZoom ?? 1;
    const byId = new Map<number, LmcCluster>();
    let nextId = 1;

    const newCluster = (zoom: number): LmcCluster => {
        const cluster: LmcCluster = {
            id: nextId++,
            zoom,
            cLatLng: new LatLng(0, 0),
            wLatLng: new LatLng(0, 0),
            childCount: 0,
            markers: [],
            childClusters: [],
            parent: null,
        };
        byId.set(cluster.id, cluster);
        return cluster;
    };

    const addChild = (cluster: LmcCluster, child: string | LmcCluster) => {
        if (typeof child === 'string') {
            cluster.markers.push(child);
            cluster.childCount += 1;
            // 原版 _setClusterCenter：锚点取第一个子点位置，之后不变
            if (cluster.childCount === 1) cluster.cLatLng = getLatLng(child);
        } else {
            child.parent = cluster;
            cluster.childClusters.push(child);
            cluster.childCount += child.childCount;
            if (cluster.childClusters.length === 1 && cluster.markers.length === 0) {
                cluster.cLatLng = child.cLatLng;
            }
        }
    };

    const removeMarkerChild = (cluster: LmcCluster, markerId: string) => {
        const index = cluster.markers.indexOf(markerId);
        if (index >= 0) {
            cluster.markers.splice(index, 1);
            cluster.childCount -= 1;
        }
    };

    const root = newCluster(LMC_ROOT_ZOOM);
    const gridClusters = new Map<number, DistanceGrid<LmcCluster>>();
    const gridUnclustered = new Map<number, DistanceGrid<string>>();
    for (let z = minZoom; z <= maxZoom; z++) {
        gridClusters.set(z, new DistanceGrid<LmcCluster>(radius));
        gridUnclustered.set(z, new DistanceGrid<string>(radius));
    }
    const clustersAt = (zoom: number): DistanceGrid<LmcCluster> => {
        const grid = gridClusters.get(zoom);
        if (!grid) throw new Error(`missing cluster grid for zoom ${zoom}`);
        return grid;
    };
    const unclusteredAt = (zoom: number): DistanceGrid<string> => {
        const grid = gridUnclustered.get(zoom);
        if (!grid) throw new Error(`missing unclustered grid for zoom ${zoom}`);
        return grid;
    };
    /** markerId → 所属簇（原 __parent） */
    const parentOf = new Map<string, LmcCluster>();
    /** markerId → latlng 缓存 */
    const latLngCache = new Map<string, LatLng>();
    const latLngOf = (markerId: string): LatLng => {
        let latlng = latLngCache.get(markerId);
        if (!latlng) {
            latlng = getLatLng(markerId);
            latLngCache.set(markerId, latlng);
        }
        return latlng;
    };

    for (const markerId of markerIds) {
        let placed = false;
        for (let zoom = maxZoom; zoom >= minZoom && !placed; zoom--) {
            const markerPoint = projectAtZoom(latLngOf(markerId), zoom);

            // 尝试加入近邻簇
            const closestCluster = clustersAt(zoom).getNearObject(markerPoint);
            if (closestCluster) {
                addChild(closestCluster, markerId);
                parentOf.set(markerId, closestCluster);
                placed = true;
                break;
            }

            // 尝试与近邻单点合成新簇
            const closestMarkerId = unclusteredAt(zoom).getNearObject(markerPoint);
            if (closestMarkerId) {
                const parent = parentOf.get(closestMarkerId) ?? root;
                // 原版 _removeLayer(closest, false)：从原所属中移除
                if (parent !== root) removeMarkerChild(parent, closestMarkerId);
                else removeMarkerChild(root, closestMarkerId);

                const newPairCluster = newCluster(zoom);
                addChild(newPairCluster, closestMarkerId);
                addChild(newPairCluster, markerId);
                clustersAt(zoom).addObject(
                    newPairCluster,
                    projectAtZoom(newPairCluster.cLatLng, zoom),
                );
                parentOf.set(closestMarkerId, newPairCluster);
                parentOf.set(markerId, newPairCluster);

                // 该层未聚合记录中移除 closest（原版 _removeFromGridUnclustered）
                unclusteredAt(zoom).removeObject(
                    closestMarkerId,
                    projectAtZoom(latLngOf(closestMarkerId), zoom),
                );

                // 向上补中间父簇
                let lastParent = newPairCluster;
                for (let z = zoom - 1; z > parent.zoom; z--) {
                    const intermediate = newCluster(z);
                    addChild(intermediate, lastParent);
                    clustersAt(z).addObject(
                        intermediate,
                        projectAtZoom(latLngOf(closestMarkerId), z),
                    );
                    lastParent = intermediate;
                }
                addChild(parent, lastParent);

                placed = true;
                break;
            }

            // 本层未聚合：记录后继续向上
            unclusteredAt(zoom).addObject(markerId, markerPoint);
        }

        if (!placed) {
            addChild(root, markerId);
            parentOf.set(markerId, root);
        }
    }

    // 自底向上计算加权质心（原版 _wLatLng：叶子按 1 计，子簇按 childCount 加权）
    const computeWeighted = (cluster: LmcCluster): { lat: number; lng: number; count: number } => {
        let latSum = 0;
        let lngSum = 0;
        let count = 0;
        for (const markerId of cluster.markers) {
            const latlng = latLngOf(markerId);
            latSum += latlng.lat;
            lngSum += latlng.lng;
            count += 1;
        }
        for (const child of cluster.childClusters) {
            const childWeighted = computeWeighted(child);
            latSum += childWeighted.lat * childWeighted.count;
            lngSum += childWeighted.lng * childWeighted.count;
            count += childWeighted.count;
        }
        if (count > 0) {
            cluster.wLatLng = new LatLng(latSum / count, lngSum / count);
        }
        return { lat: latSum, lng: lngSum, count };
    };
    computeWeighted(root);

    return { root, byId };
};

/** 某一层级应显示的聚合簇与叶子（对应原版该 _zoom 的显示递归） */
export const visibleAtLevel = (
    tree: ClusterTree,
    level: number,
): { clusters: LmcCluster[]; leafIds: string[] } => {
    const clusters: LmcCluster[] = [];
    const leafIds: string[] = [];
    const { root } = tree;

    if (level === 0) {
        clusters.push(...root.childClusters);
        leafIds.push(...root.markers);
        return { clusters, leafIds };
    }

    // level >= 1：显示各 zoom-0 簇内的 zoom-1 子簇 + 未进入 zoom-1 簇的叶子
    for (const zoom0 of root.childClusters) {
        clusters.push(...zoom0.childClusters);
        leafIds.push(...zoom0.markers);
    }
    leafIds.push(...root.markers);
    return { clusters, leafIds };
};

/** 簇的全部后代 marker id（原 getAllChildMarkers） */
export const getLeafIds = (cluster: LmcCluster): string[] => {
    const ids: string[] = [...cluster.markers];
    for (const child of cluster.childClusters) {
        ids.push(...getLeafIds(child));
    }
    return ids;
};

/**
 * 展开缩放（对应原版 _zoomOrSpiderfy 的判定）：
 * 返回值 > 最后一个聚合层级（maxZoom=1）→ 簇在聚合树内不可再拆分（spiderfy）；
 * 否则返回再放大一级即散开的层级（flyTo 目标）。
 */
export const getExpansionZoom = (cluster: LmcCluster, maxZoom = 1): number => {
    if (cluster.zoom >= maxZoom) return maxZoom + 1;
    // 沿单子链向下：到达底层且 childCount 不变 → 不可拆分
    let bottom = cluster;
    while (bottom.childClusters.length === 1) {
        bottom = bottom.childClusters[0];
    }
    if (bottom.zoom === maxZoom && bottom.childCount === cluster.childCount) {
        return maxZoom + 1;
    }
    return cluster.zoom + 1;
};
