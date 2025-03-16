/**
 * 从瓦片组检测边界多边形
 * @param {Array} tiles - 瓦片数组
 * @param {number} tileSize - 瓦片大小
 * @returns {Array} 边界多边形数组
 */
export const detectPolygon = (tiles, tileSize) => {
    if (!tiles || tiles.length === 0) return [];

    console.log(`開始檢測 ${tiles.length} 塊瓦片之邊界`);

    // 创建瓦片占位网格
    const tileGrid = {};
    tiles.forEach(tile => {
        tileGrid[`${tile.x},${tile.y}`] = true;
    });

    // 收集边界边
    const boundaryEdges = [];

    tiles.forEach(tile => {
        const { x, y } = tile;

        // 检查四个方向是否有相邻瓦片，如果没有则该方向的边是边界
        if (!tileGrid[`${x},${y - 1}`]) {  // 上边
            boundaryEdges.push({
                from: [x * tileSize, y * tileSize],
                to: [(x + 1) * tileSize, y * tileSize],
                key: `${x},${y}-top`
            });
        }

        if (!tileGrid[`${x + 1},${y}`]) {  // 右边
            boundaryEdges.push({
                from: [(x + 1) * tileSize, y * tileSize],
                to: [(x + 1) * tileSize, (y + 1) * tileSize],
                key: `${x},${y}-right`
            });
        }

        if (!tileGrid[`${x},${y + 1}`]) {  // 下边
            boundaryEdges.push({
                from: [(x + 1) * tileSize, (y + 1) * tileSize],
                to: [x * tileSize, (y + 1) * tileSize],
                key: `${x},${y}-bottom`
            });
        }

        if (!tileGrid[`${x - 1},${y}`]) {  // 左边
            boundaryEdges.push({
                from: [x * tileSize, (y + 1) * tileSize],
                to: [x * tileSize, y * tileSize],
                key: `${x},${y}-left`
            });
        }
    });

    console.log(`找到 ${boundaryEdges.length} 条邊界邊`);

    // 将边连接成闭合多边形
    const rawPolygons = buildPolygons(boundaryEdges);
    // 应用矩形拼接特化优化
    const optimizedPolygons = optiVertexes(rawPolygons);
    console.log(`優化結果：原始點数量=${countPoints(rawPolygons)}, 優化後點數量=${countPoints(optimizedPolygons)}`);

    return optimizedPolygons;
};

/**
 * 从边集合构建闭合多边形
 * @param {Array} edges - 边界边集合
 * @returns {Array} 多边形坐标数组
 */
const buildPolygons = (edges) => {
    if (edges.length === 0) return [];
    // 创建边的哈希表，用于快速查找
    const edgeMap = new Map();
    edges.forEach(edge => {
        const fromKey = `${edge.from[0]},${edge.from[1]}`;
        if (!edgeMap.has(fromKey)) {
            edgeMap.set(fromKey, []);
        }
        edgeMap.get(fromKey).push(edge);
    });

    const polygons = [];
    const usedEdges = new Set();

    // 对每个未使用的边尝试构建多边形
    while (usedEdges.size < edges.length) {
        // 找到一个未使用的边作为起点
        const startEdge = edges.find(edge => !usedEdges.has(edge.key));
        if (!startEdge) break;

        usedEdges.add(startEdge.key);

        // 开始一个新多边形
        const polygon = [startEdge.from.slice()];
        let currentPoint = startEdge.to.slice();
        polygon.push(currentPoint);

        // 寻找连续的边直到闭合
        let maxIterations = edges.length * 2; // 防止无限循环
        while (maxIterations-- > 0) {
            // 寻找从当前点出发的边
            const currentKey = `${currentPoint[0]},${currentPoint[1]}`;
            const nextEdges = edgeMap.get(currentKey) || [];
            const nextEdge = nextEdges.find(edge => !usedEdges.has(edge.key));

            if (!nextEdge) {
                // 如果找不到下一条边，尝试通过点的接近程度查找
                const closest = findClosestEdgeByPoint(currentPoint, edges, usedEdges);
                if (closest) {
                    // 添加连接点
                    polygon.push(closest.edge.from.slice());
                    currentPoint = closest.edge.to.slice();
                    usedEdges.add(closest.edge.key);
                    polygon.push(currentPoint);
                    continue;
                } else {
                    console.warn('無法閉合多邊形：找不到下一條邊');
                    break;
                }
            }

            // 使用找到的边
            usedEdges.add(nextEdge.key);
            currentPoint = nextEdge.to.slice();
            polygon.push(currentPoint);

            // 检查是否闭合 (回到起点)
            if (pointsEqual(currentPoint, polygon[0])) {
                // 闭合了，移除重复的起点
                polygon.pop();
                break;
            }
        }

        // 处理有效多边形（至少3个点）
        if (polygon.length >= 3) {
            // 确保多边形闭合
            if (!pointsEqual(polygon[0], polygon[polygon.length - 1])) {
                polygon.push(polygon[0].slice());
            }
            polygons.push(polygon);
        } else {
            console.warn('點數不足');
        }
    }

    console.log(`構建了 ${polygons.length} 個多邊形`);

    // 面積降序排列
    if (polygons.length > 1) {
        const sortedPolygons = [...polygons];
        sortedPolygons.sort((a, b) => calculatePolygonArea(b) - calculatePolygonArea(a));
        return sortedPolygons;
    }

    return polygons;
};

/**
 * 优化矩形拼接形成的多边形集合
 * @param {Array} polygons - 多边形数组
 * @returns {Array} 优化后的多边形数组
 */
const optiVertexes = (polygons) => {
    return polygons.map(polygon => optiRects(polygon));
};

/**
 * 优化矩形拼接形成的单个多边形
 * @param {Array} polygon - 多边形点数组
 * @returns {Array} 优化后的多边形
 */
const optiRects = (polygon) => {
    if (!polygon || polygon.length < 4) return polygon;

    // 移除闭合点进行处理
    let pts = [...polygon];
    const isClosed = pointsEqual(pts[0], pts[pts.length - 1]);
    if (isClosed) pts.pop();

    // 标准化所有点到网格（修正浮点误差）
    pts = snapToGrid(pts);

    // 移除共线点
    let result = [];
    result.push(pts[0]);

    for (let i = 1; i < pts.length - 1; i++) {
        const prev = result[result.length - 1];
        const curr = pts[i];
        const next = pts[i + 1];

        // 如果三点共线，跳过当前点
        if (isHorizontalOrVertical(prev, curr, next)) {
            continue;
        }

        result.push(curr);
    }

    // 添加最后一个点
    result.push(pts[pts.length - 1]);

    // 进一步处理首尾点
    if (result.length >= 3) {
        // 检查最后一点是否与倒数第二和第一点共线
        if (isHorizontalOrVertical(result[result.length - 2], result[result.length - 1], result[0])) {
            result.pop();
        }

        // 检查第一点是否与最后一点和第二点共线
        if (result.length >= 3 && isHorizontalOrVertical(result[result.length - 1], result[0], result[1])) {
            result.shift();
            result.push(result.shift());
        }
    }

    // 检查是否为矩形并标准化
    if (result.length === 4 && isRectangle(result)) {
        result = createStandardRectangle(result);
    }

    // 确保闭合
    if (isClosed && !pointsEqual(result[0], result[result.length - 1])) {
        result.push([...result[0]]);
    }

    return result;
};

// --------- 辅助函数 ---------

/**
 * 计算多边形集合中的总点数
 */
const countPoints = (polygons) => {
    return polygons.reduce((sum, polygon) => sum + polygon.length, 0);
};

/**
 * 查找与指定点最接近的边
 */
const findClosestEdgeByPoint = (point, edges, usedEdges) => {
    let closest = null;
    let minDistance = Infinity;

    for (const edge of edges) {
        if (usedEdges.has(edge.key)) continue;

        const dist = Math.sqrt(
            Math.pow(point[0] - edge.from[0], 2) +
            Math.pow(point[1] - edge.from[1], 2)
        );

        if (dist < minDistance) {
            minDistance = dist;
            closest = { edge, distance: dist };
        }
    }

    return closest && closest.distance < 5 ? closest : null;
};

/**
 * 计算多边形面积
 */
const calculatePolygonArea = (polygon) => {
    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
        const j = (i + 1) % polygon.length;
        area += polygon[i][0] * polygon[j][1];
        area -= polygon[j][0] * polygon[i][1];
    }
    return Math.abs(area) / 2;
};

/**
 * 检查两点是否相等
 */
const pointsEqual = (p1, p2, epsilon = 0.001) => {
    return Math.abs(p1[0] - p2[0]) < epsilon &&
        Math.abs(p1[1] - p2[1]) < epsilon;
};

/**
 * 将点对齐到网格
 */
const snapToGrid = (points, epsilon = 0.1) => {
    return points.map(p => [
        Math.round(p[0] / epsilon) * epsilon,
        Math.round(p[1] / epsilon) * epsilon
    ]);
};

/**
 * 检查三点共线（水平或垂直）
 */
const isHorizontalOrVertical = (p1, p2, p3) => {
    return (Math.abs(p1[1] - p2[1]) < 0.1 && Math.abs(p2[1] - p3[1]) < 0.1) || // 水平共线
           (Math.abs(p1[0] - p2[0]) < 0.1 && Math.abs(p2[0] - p3[0]) < 0.1);   // 垂直共线
};

/**
 * 检查多边形是否为矩形
 */
const isRectangle = (points) => {
    if (points.length !== 4) return false;

    // 检查是否只有水平和垂直边
    let horizontalCount = 0, verticalCount = 0;
    for (let i = 0; i < 4; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % 4];

        const isHorizontal = Math.abs(p1[1] - p2[1]) < 0.1;
        const isVertical = Math.abs(p1[0] - p2[0]) < 0.1;

        if (!isHorizontal && !isVertical) return false;
        if (isHorizontal) horizontalCount++;
        if (isVertical) verticalCount++;
    }

    return horizontalCount === 2 && verticalCount === 2;
};

/**
 * 创建标准矩形表示
 */
const createStandardRectangle = (points) => {
    const xValues = points.map(p => p[0]);
    const yValues = points.map(p => p[1]);
    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);

    return [
        [minX, minY], // 左上
        [maxX, minY], // 右上
        [maxX, maxY], // 右下
        [minX, maxY], // 左下
        [minX, minY]  // 左上(闭合)
    ];
};