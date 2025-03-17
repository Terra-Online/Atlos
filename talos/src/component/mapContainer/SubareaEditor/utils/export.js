/**
 * 將子區域資料格式化為導出格式
 * @param {Array} subregions - 子區域列表
 * @param {Object} config - 地圖配置
 * @returns {Object} 格式化後的子區域資料
 */
export const formatSubregionsForExport = (subregions, config) => {
    return {
        regionId: config.regionId || "unknown_region",
        subregions: subregions.map(subregion => {
            // 計算邊界框
            const minX = Math.min(...subregion.tileCoords.map(coord => coord[0]));
            const minY = Math.min(...subregion.tileCoords.map(coord => coord[1]));
            const maxX = Math.max(...subregion.tileCoords.map(coord => coord[0]));
            const maxY = Math.max(...subregion.tileCoords.map(coord => coord[1]));

            // 轉換為實際像素坐標 (全部用陣列而不換行)
            const bounds = [[minX * config.tileSize, minY * config.tileSize], 
                           [(maxX + 1) * config.tileSize, (maxY + 1) * config.tileSize]];

            return {
                id: subregion.id,
                name: subregion.name,
                color: subregion.color,
                bounds,
                tiles: subregion.tiles.length,
                tileCoords: subregion.tileCoords,
                polygon: subregion.polygon
            };
        })
    };
};

/**
 * 導出子區域資料到JSON檔案
 * @param {Object} data - 子區域資料
 * @param {String} filename - 檔案名稱
 */
export const exportToJSON = (data, filename = 'subregions.json') => {
    // 使用選項null與空格數0產生緊湊JSON
    const jsonString = JSON.stringify(data, null, 0);
    
    // 建立下載連結
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    
    // 模擬點擊下載
    link.click();
    
    // 清理
    setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, 100);
};