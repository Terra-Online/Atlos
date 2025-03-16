// 存储之前生成的颜色，用于确保新颜色的差异性
const previousColors = [];

/**
 * 生成视觉上区分度高的随机颜色（十六进制格式）
 * @returns {String} 十六进制颜色字符串
 */
export const generateRandomColor = () => {
    // 使用黄金角分割法生成色相，确保颜色分布均匀
    const goldenRatioConjugate = 0.618033988749895;
    let h = Math.random(); // 随机起始点

    // 每次使用黄金角旋转确保颜色分布
    h += goldenRatioConjugate;
    h %= 1;

    // 将色相转换为0-360度
    const hue = Math.floor(h * 360);

    // 使用固定的饱和度和亮度确保颜色鲜艳可见
    const saturation = 70 + Math.floor(Math.random() * 20); // 70-89%
    const lightness = 45 + Math.floor(Math.random() * 10); // 45-54%

    // 将HSL转换为十六进制
    const color = hslToHex(hue, saturation, lightness);

    // 检查与前三个颜色的差异度
    if (previousColors.length > 0) {
        const minDistance = Math.min(...previousColors.map(prevColor =>
            calculateColorDistance(color, prevColor)
        ));

        // 如果颜色太相似，重新生成
        if (minDistance < 100) {
            return generateRandomColor();
        }
    }

    // 記錄當前颜色以便后续比较
    previousColors.push(color);
    if (previousColors.length > 6) {
        previousColors.shift(); // 只保留最近的6个颜色
    }

    return color;
};

/**
 * 计算两个颜色的距离（简化的欧氏距离）
 * @param {String} color1 - 十六进制颜色1
 * @param {String} color2 - 十六进制颜色2
 * @returns {Number} 颜色距离值
 */
const calculateColorDistance = (color1, color2) => {
    // 去掉#前缀
    const hex1 = color1.substring(1);
    const hex2 = color2.substring(1);

    // 分解为RGB
    const r1 = parseInt(hex1.substring(0, 2), 16);
    const g1 = parseInt(hex1.substring(2, 4), 16);
    const b1 = parseInt(hex1.substring(4, 6), 16);

    const r2 = parseInt(hex2.substring(0, 2), 16);
    const g2 = parseInt(hex2.substring(2, 4), 16);
    const b2 = parseInt(hex2.substring(4, 6), 16);

    // 计算欧氏距离
    return Math.sqrt(
        Math.pow(r1 - r2, 2) +
        Math.pow(g1 - g2, 2) +
        Math.pow(b1 - b2, 2)
    );
};

/**
 * 将HSL颜色转换为十六进制格式
 * @param {Number} h - 色相 (0-360)
 * @param {Number} s - 饱和度 (0-100)
 * @param {Number} l - 亮度 (0-100)
 * @returns {String} 十六进制颜色字符串
 */
const hslToHex = (h, s, l) => {
    s /= 100;
    l /= 100;

    // 色相转RGB辅助函数
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };

    let r, g, b;

    if (s === 0) {
        // 灰色
        r = g = b = l;
    } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, (h / 360) + 1 / 3);
        g = hue2rgb(p, q, h / 360);
        b = hue2rgb(p, q, (h / 360) - 1 / 3);
    }

    // 转换为十六进制
    const toHex = c => {
        const hex = Math.round(c * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};
/**
 * 获取指定区域包含的瓦片ID列表
 * @param {Array} polygon - 多边形边界
 * @param {Array} tileGrid - 所有瓦片
 * @param {Object} config - 地图配置
 * @returns {Array} 瓦片ID列表
 */
export const getTilesInPolygon = (polygon, tileGrid, config) => {
    const tileSize = config.tileSize;
    const tilesInPolygon = [];

    // 计算多边形的边界框以优化计算
    const bounds = calculateBoundingBox(polygon);

    // 检查每个瓦片
    tileGrid.forEach(tile => {
        const { x, y, id } = tile;

        // 快速过滤：检查瓦片是否与边界框相交
        const tileMinX = x * tileSize;
        const tileMinY = y * tileSize;
        const tileMaxX = (x + 1) * tileSize;
        const tileMaxY = (y + 1) * tileSize;

        if (tileMaxX < bounds.minX || tileMinX > bounds.maxX ||
            tileMaxY < bounds.minY || tileMinY > bounds.maxY) {
            return; // 瓦片在边界框之外
        }

        // 检查瓦片中心是否在多边形内
        const centerX = tileMinX + tileSize / 2;
        const centerY = tileMinY + tileSize / 2;

        if (isPointInPolygon([centerX, centerY], polygon)) {
            tilesInPolygon.push(id);
        }
    });

    return tilesInPolygon;
};

/**
 * 计算多边形的边界框
 * @param {Array} polygon - 多边形点集
 * @returns {Object} 边界框 {minX, minY, maxX, maxY}
 */
const calculateBoundingBox = (polygon) => {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    polygon.forEach(point => {
        minX = Math.min(minX, point[0]);
        minY = Math.min(minY, point[1]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
    });

    return { minX, minY, maxX, maxY };
};

/**
 * 判断点是否在多边形内部
 * 使用射线法(Ray Casting Algorithm)
 * @param {Array} point - 待检测点 [x, y]
 * @param {Array} polygon - 多边形点集 [[x1, y1], [x2, y2], ...]
 * @returns {Boolean} 是否在多边形内
 */
export const isPointInPolygon = (point, polygon) => {
    const x = point[0], y = point[1];
    let inside = false;

    // 遍历多边形的每条边
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];

        // 点在当前边的垂直投影上，且在边上
        if (((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }

    return inside;
};

/**
 * 根据瓦片列表生成瓦片图层
 * @param {Array} tileIds - 瓦片ID列表
 * @param {Object} tileGrid - 瓦片网格数据
 * @param {Object} options - 配置选项 {color, opacity, weight}
 * @param {L.Map} map - Leaflet地图实例
 * @returns {L.LayerGroup} 瓦片图层组
 */
export const createTileLayers = (tileIds, tileGrid, options, map) => {
    const layerGroup = L.layerGroup();
    const tileSize = options.tileSize || 256;
    const tileById = tileGrid.reduce((acc, tile) => {
        acc[tile.id] = tile;
        return acc;
    }, {});

    tileIds.forEach(id => {
        const tile = tileById[id];
        if (!tile) return;

        const { x, y } = tile;
        // 计算瓦片边界
        const sw = map.unproject([x * tileSize, (y + 1) * tileSize], 0);
        const ne = map.unproject([(x + 1) * tileSize, y * tileSize], 0);
        const bounds = L.latLngBounds(sw, ne);

        // 创建矩形表示瓦片
        const rect = L.rectangle(bounds, {
            color: options.color || '#3388ff',
            weight: options.weight || 1,
            opacity: options.opacity || 0.5,
            fillOpacity: options.fillOpacity || 0.2,
            fillColor: options.color || '#3388ff',
            interactive: options.interactive || false
        }).addTo(layerGroup);

        // 保存瓦片ID以便后续查找
        rect.tileId = id;
    });

    if (map) {
        layerGroup.addTo(map);
    }

    return layerGroup;
};