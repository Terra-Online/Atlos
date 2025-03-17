// 儲存先前產生的顏色，用來確保新顏色有足夠差異性
const previousColors = [];

/**
 * 產生視覺上區分度高的隨機顏色（十六進制格式），用於區域填充
 * @returns {String} 十六進制顏色字串
 */
export const generateRandomColor = () => {
    // 使用黃金角分割法產生色相，確保顏色分佈均勻
    const goldenRatioConjugate = 0.618033988749895;
    let h = Math.random(); // 隨機起始點

    // 每次使用黃金角旋轉確保顏色分佈
    h += goldenRatioConjugate;
    h %= 1;

    // 將色相轉換為0-360度
    const hue = Math.floor(h * 360);

    // 使用固定的飽和度和亮度確保顏色鮮艷可見
    const saturation = 70 + Math.floor(Math.random() * 20); // 70-89%
    const lightness = 45 + Math.floor(Math.random() * 10); // 45-54%

    // 將HSL轉換為十六進制
    const color = hslToHex(hue, saturation, lightness);

    // 檢查與前幾個顏色的差異度
    if (previousColors.length > 0) {
        const minDistance = Math.min(...previousColors.map(prevColor =>
            calculateColorDistance(color, prevColor)
        ));

        // 如果顏色太相似，重新產生
        if (minDistance < 100) {
            return generateRandomColor();
        }
    }

    // 記錄當前顏色以便後續比較
    previousColors.push(color);
    if (previousColors.length > 6) {
        previousColors.shift(); // 只保留最近的6個顏色
    }

    return color;
};

/**
 * 計算兩個顏色的距離（簡化的歐氏距離）
 * @param {String} color1 - 十六進制顏色1
 * @param {String} color2 - 十六進制顏色2
 * @returns {Number} 顏色距離值
 */
const calculateColorDistance = (color1, color2) => {
    // 去掉#前綴
    const hex1 = color1.substring(1);
    const hex2 = color2.substring(1);

    // 分解為RGB
    const r1 = parseInt(hex1.substring(0, 2), 16);
    const g1 = parseInt(hex1.substring(2, 4), 16);
    const b1 = parseInt(hex1.substring(4, 6), 16);

    const r2 = parseInt(hex2.substring(0, 2), 16);
    const g2 = parseInt(hex2.substring(2, 4), 16);
    const b2 = parseInt(hex2.substring(4, 6), 16);

    // 計算歐氏距離
    return Math.sqrt(
        Math.pow(r1 - r2, 2) +
        Math.pow(g1 - g2, 2) +
        Math.pow(b1 - b2, 2)
    );
};

/**
 * 將HSL顏色轉換為十六進制格式
 * @param {Number} h - 色相 (0-360)
 * @param {Number} s - 飽和度 (0-100)
 * @param {Number} l - 亮度 (0-100)
 * @returns {String} 十六進制顏色字串
 */
const hslToHex = (h, s, l) => {
    s /= 100;
    l /= 100;

    // 色相轉RGB輔助函式
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

    // 轉換為十六進制
    const toHex = c => {
        const hex = Math.round(c * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

/**
 * 取得指定區域包含的瓦片ID列表
 * @param {Array} polygon - 多邊形邊界
 * @param {Array} tileGrid - 所有瓦片
 * @param {Object} config - 地圖配置
 * @returns {Array} 瓦片ID列表
 */
export const getTilesInPolygon = (polygon, tileGrid, config) => {
    const tileSize = config.tileSize;
    const tilesInPolygon = [];

    // 計算多邊形的邊界框以優化運算
    const bounds = calculateBoundingBox(polygon);

    // 檢查每個瓦片
    tileGrid.forEach(tile => {
        const { x, y, id } = tile;

        // 快速篩選：檢查瓦片是否與邊界框相交
        const tileMinX = x * tileSize;
        const tileMinY = y * tileSize;
        const tileMaxX = (x + 1) * tileSize;
        const tileMaxY = (y + 1) * tileSize;

        if (tileMaxX < bounds.minX || tileMinX > bounds.maxX ||
            tileMaxY < bounds.minY || tileMinY > bounds.maxY) {
            return; // 瓦片在邊界框之外
        }

        // 檢查瓦片中心是否在多邊形內
        const centerX = tileMinX + tileSize / 2;
        const centerY = tileMinY + tileSize / 2;

        if (isPointInPolygon([centerX, centerY], polygon)) {
            tilesInPolygon.push(id);
        }
    });

    return tilesInPolygon;
};

/**
 * 計算多邊形的邊界框
 * @param {Array} polygon - 多邊形點集
 * @returns {Object} 邊界框 {minX, minY, maxX, maxY}
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
 * 判斷點是否在多邊形內部
 * 使用射線法(Ray Casting Algorithm)
 * @param {Array} point - 待檢測點 [x, y]
 * @param {Array} polygon - 多邊形點集 [[x1, y1], [x2, y2], ...]
 * @returns {Boolean} 是否在多邊形內
 */
export const isPointInPolygon = (point, polygon) => {
    const x = point[0], y = point[1];
    let inside = false;

    // 遍歷多邊形的每條邊
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];

        // 點在當前邊的垂直投影上，且在邊上
        if (((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }

    return inside;
};

/**
 * 根據瓦片列表生成瓦片圖層
 * @param {Array} tileIds - 瓦片ID列表
 * @param {Object} tileGrid - 瓦片網格資料
 * @param {Object} options - 配置選項 {color, opacity, weight}
 * @param {L.Map} map - Leaflet地圖實例
 * @returns {L.LayerGroup} 瓦片圖層組
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
        // 計算瓦片邊界
        const sw = map.unproject([x * tileSize, (y + 1) * tileSize], 0);
        const ne = map.unproject([(x + 1) * tileSize, y * tileSize], 0);
        const bounds = L.latLngBounds(sw, ne);

        // 建立矩形表示瓦片
        const rect = L.rectangle(bounds, {
            color: options.color || '#3388ff',
            weight: options.weight || 1,
            opacity: options.opacity || 0.5,
            fillOpacity: options.fillOpacity || 0.2,
            fillColor: options.color || '#3388ff',
            interactive: options.interactive || false
        }).addTo(layerGroup);

        // 儲存瓦片ID以便後續查找
        rect.tileId = id;
    });

    if (map) {
        layerGroup.addTo(map);
    }

    return layerGroup;
};