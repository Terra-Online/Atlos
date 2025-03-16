/**
 * 将子区域数据格式化为导出格式
 * @param {Array} subregions - 子区域列表
 * @param {Object} config - 地图配置
 * @returns {Array} 格式化后的子区域数据
 */
export const formatSubregionsForExport = (subregions, config) => {
    return {
        regionId: config.regionId || "unknown_region",
        subregions: subregions.map(subregion => {
            // 计算边界框
            const minX = Math.min(...subregion.tileCoords.map(coord => coord[0]));
            const minY = Math.min(...subregion.tileCoords.map(coord => coord[1]));
            const maxX = Math.max(...subregion.tileCoords.map(coord => coord[0]));
            const maxY = Math.max(...subregion.tileCoords.map(coord => coord[1]));

            // 转换为实际像素坐标
            const bounds = [
                [minX * config.tileSize, minY * config.tileSize],
                [(maxX + 1) * config.tileSize, (maxY + 1) * config.tileSize]
            ];

            return {
                id: subregion.id,
                name: subregion.name,
                color: subregion.color,
                bounds, // 边界框
                tiles: subregion.tiles.length, // 瓦片数量
                tileCoords: subregion.tileCoords, // 瓦片坐标数组
                polygon: subregion.polygon // 保留多边形数据
            };
        })
    };
};