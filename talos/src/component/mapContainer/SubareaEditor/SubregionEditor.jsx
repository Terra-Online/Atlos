import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import './SubregionEditor.scss';
import { detectPolygon } from './utils/polygonDetector';
import { generateRandomColor, getTilesInPolygon, createTileLayers, isPointInPolygon } from './utils/tileManager';
import { formatSubregionsForExport } from './utils/export';

const SubregionEditor = ({ map, regionId, config, onExport, onClose }) => {
    const [tileGrid, setTileGrid] = useState([]); // 网格状态
    const [subregions, setSubregions] = useState([]); // 子区域列表
    const [activeSubregion, setActiveSubregion] = useState(null); // 当前活动子区域
    const [selectedTiles, setSelectedTiles] = useState([]); // 当前选中的瓦片
    const [editingSubregion, setEditingSubregion] = useState(null); // 正在编辑的子区域
    const [isSelecting, setIsSelecting] = useState(false); // 是否正在进行拖拽多选
    const [tileOwnership, setTileOwnership] = useState({}); // 瓦片所属子区域映射

    // 引用保持瓦片图层
    const tileLayersRef = useRef({
        grid: null,
        tiles: {} // 用于存储每个瓦片的图层引用
    });
    const polygonLayersRef = useRef([]);
    const savedMapStateRef = useRef(null);

    // 跟踪鼠标和键盘状态
    const mouseDownRef = useRef(false);
    const cmdKeyPressedRef = useRef(false);


    // 初始化编辑器
    useEffect(() => {
        if (!map) return;
        // 保存当前地图状态，以便退出编辑器时恢复
        savedMapStateRef.current = {
            zoom: map.getZoom(),
            center: map.getCenter()
        };

        // 将地图设置为最大缩放级别
        const maxZoom = config.maxZoom || 2; // 默认最大缩放级别为2，如果配置中没有提供
        map.setZoom(maxZoom);

        // 创建瓦片网格
        const tilesX = Math.ceil(config.dimensions[0] / config.tileSize);
        const tilesY = Math.ceil(config.dimensions[1] / config.tileSize);

        const grid = [];
        for (let y = 0; y < tilesY; y++) {
            for (let x = 0; x < tilesX; x++) {
                grid.push({
                    id: `tile-${x}-${y}`,
                    x, y,
                    subregion: null // 初始未分配给任何子区域
                });
            }
        }
        setTileGrid(grid);

        // 初始化瓦片所属关系 - 所有瓦片初始归属于"未分配"
        const initialOwnership = {};
        grid.forEach(tile => {
            initialOwnership[tile.id] = ["unsplit"];
        });
        setTileOwnership(initialOwnership);

        // 创建"未分割"子区域
        setSubregions([{
            id: "unsplit",
            name: "未分配区域",
            color: "#cccccc",
            tiles: grid.map(tile => tile.id),
            polygon: []
        }]);

        // 添加网格可视化图层
        const gridLayer = L.layerGroup().addTo(map);
        const tileLayersMap = {}; // 存储瓦片图层

        grid.forEach(tile => {
            const { x, y, id } = tile;
            // 计算瓦片边界
            const sw = map.unproject([x * config.tileSize, (y + 1) * config.tileSize], maxZoom);
            const ne = map.unproject([(x + 1) * config.tileSize, y * config.tileSize], maxZoom);
            const bounds = L.latLngBounds(sw, ne);

            // 创建矩形表示瓦片
            const rect = L.rectangle(bounds, {
                color: '#999',
                weight: 1,
                opacity: 0.5,
                fillOpacity: 0.1,
                fillColor: '#ccc',
                interactive: true
            }).addTo(gridLayer);

            // 保存瓦片ID和图层引用
            rect.tileId = id;
            tileLayersMap[id] = rect; // 保存图层引用

            // 添加点击事件
            rect.on('click', () => {
                handleTileClick(tile);
            });


            // 添加鼠标悬停事件，支持拖拽多选
            rect.on('mouseover', () => {
                // 只有在Command/Ctrl键和鼠标按下时才执行多选
                if (mouseDownRef.current && cmdKeyPressedRef.current) {
                    const isAlreadySelected = selectedTiles.findIndex(t => t.id === tile.id) !== -1;
                    if (!isAlreadySelected) {
                        // 使用Set数据结构确保不重复添加
                        setSelectedTiles(prev => {
                            // 避免重复添加同一瓦片
                            const tileExists = prev.some(t => t.id === tile.id);
                            if (tileExists) return prev;
                            return [...prev, tile];
                        });
                        updateTileStyle(tile.id, true);
                    }
                }
            });
        });

        tileLayersRef.current = {
            grid: gridLayer,
            tiles: tileLayersMap
        };
        // 键盘按下事件 - 跟踪Command/Ctrl键状态
        const handleKeyDown = (e) => {
            if (e.metaKey || e.ctrlKey) {
                cmdKeyPressedRef.current = true;
            }
        };

        // 键盘释放事件
        const handleKeyUp = (e) => {
            if (e.key === 'Meta' || e.key === 'Control') {
                cmdKeyPressedRef.current = false;
                if (isSelecting) {
                    setIsSelecting(false);
                    map.dragging.enable();
                }
            }
        };

        // 鼠标按下事件
        const handleMouseDown = (e) => {
            // 使用Command/Ctrl键时
            if (cmdKeyPressedRef.current) {
                e.preventDefault && e.preventDefault();
                mouseDownRef.current = true;
                setIsSelecting(true);
                map.dragging.disable(); // 暂时禁用地图拖动
            }
        };

        // 鼠标释放事件
        const handleMouseUp = () => {
            mouseDownRef.current = false;
            if (isSelecting) {
                setIsSelecting(false);
                map.dragging.enable(); // 恢复地图拖动
            }
        };

        // 添加各种事件监听
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('keyup', handleKeyUp);
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('mouseup', handleMouseUp);

        // 阻止Command/Ctrl+点击的默认行为
        const preventDefaultForCmdClick = (e) => {
            if (e.metaKey || e.ctrlKey) {
                e.preventDefault();
            }
        };

        map.getContainer().addEventListener('click', preventDefaultForCmdClick);

        return () => {
            // 清理函数：移除所有图层并恢复地图状态
            if (tileLayersRef.current.grid && map.hasLayer(tileLayersRef.current.grid)) {
                map.removeLayer(tileLayersRef.current.grid);
            }

            polygonLayersRef.current.forEach(layer => {
                if (map.hasLayer(layer)) {
                    map.removeLayer(layer);
                }
            });

            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('keyup', handleKeyUp);
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('mouseup', handleMouseUp);
            map.getContainer().removeEventListener('click', preventDefaultForCmdClick);

            // 恢复地图状态
            if (savedMapStateRef.current) {
                map.setView(
                    savedMapStateRef.current.center,
                    savedMapStateRef.current.zoom,
                    { animate: false }
                );
            }
        };
    }, [map, config]);
    const debug = (message, data) => {
        if (process.env.NODE_ENV !== 'production') {
            console.log(`[SubregionEditor] ${message}`, data || '');
        }
    };
    // 混色函数
    const blendColors = (colors) => {
        if (colors.length === 0) return '#ccc';
        if (colors.length === 1) return colors[0];

        const hexToRgb = (hex) => {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? {
                r: parseInt(result[1], 16),
                g: parseInt(result[2], 16),
                b: parseInt(result[3], 16)
            } : { r: 0, g: 0, b: 0 };
        };

        const rgbToHex = (r, g, b) => {
            return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
        };

        const rgbColors = colors.map(hexToRgb);
        const avg = {
            r: Math.round(rgbColors.reduce((sum, c) => sum + c.r, 0) / rgbColors.length),
            g: Math.round(rgbColors.reduce((sum, c) => sum + c.g, 0) / rgbColors.length),
            b: Math.round(rgbColors.reduce((sum, c) => sum + c.b, 0) / rgbColors.length)
        };

        return rgbToHex(avg.r, avg.g, avg.b);
    };

    // 基于瓦片所属关系更新瓦片样式
    const updateTileByReign = (tileId) => {
        const tileLayer = tileLayersRef.current.tiles[tileId];
        if (!tileLayer) return;

        const subregionIds = tileOwnership[tileId] || ['unsplit'];

        // 如果只属于"未分配"或没有归属
        if (subregionIds.length === 0 ||
            (subregionIds.length === 1 && subregionIds[0] === 'unsplit')) {
            tileLayer.setStyle({
                color: '#999',
                weight: 1,
                opacity: 0.5,
                fillOpacity: 0.1,
                fillColor: '#ccc'
            });
            return;
        }

        // 过滤掉"未分配"区域，只考虑实际子区域
        const realSubregions = subregionIds.filter(id => id !== 'unsplit');

        if (realSubregions.length === 0) {
            // 如果没有实际子区域，使用默认样式
            tileLayer.setStyle({
                color: '#999',
                weight: 1,
                opacity: 0.5,
                fillOpacity: 0.1,
                fillColor: '#ccc'
            });
        } else if (realSubregions.length === 1) {
            // 如果只属于一个子区域，直接使用该区域的颜色
            const subregion = subregions.find(sr => sr.id === realSubregions[0]);
            if (subregion) {
                tileLayer.setStyle({
                    color: subregion.color,
                    weight: 2,
                    opacity: 0.8,
                    fillOpacity: 0.4,
                    fillColor: subregion.color
                });
            }
        } else {
            // 如果属于多个子区域，混合颜色
            const colors = realSubregions.map(id => {
                const subregion = subregions.find(sr => sr.id === id);
                return subregion ? subregion.color : '#3388ff';
            });

            const blendedColor = blendColors(colors);

            tileLayer.setStyle({
                color: colors[0], // 使用第一个颜色作为边框
                weight: 2,
                opacity: 0.8,
                fillOpacity: 0.6,
                fillColor: blendedColor
            });
        }
    };

    // 選擇瓦片样式函数
    const updateTileStyle = (tileId, isSelected, color = '#3388ff') => {
        const tileLayer = tileLayersRef.current.tiles[tileId];
        if (!tileLayer) return;

        if (isSelected) {
            // 高亮样式
            tileLayer.setStyle({
                color: color,
                weight: 2,
                fillOpacity: 0.4,
                fillColor: color
            });
        } else {
            // 根据所有权设置样式，而不是使用默认样式
            updateTileByReign(tileId);
        }
    };
    // 处理瓦片点击
    const handleTileClick = (tile) => {
        if (editingSubregion) {
            // 如果正在编辑子区域，则将瓦片添加到该子区域
            transferTileToSubregion(tile.id, editingSubregion.id);
            return;
        }

        // 切换瓦片选中状态
        setSelectedTiles(prev => {
            const isSelected = prev.some(t => t.id === tile.id);
            const newSelectedTiles = isSelected
                ? prev.filter(t => t.id !== tile.id)
                : [...prev, tile];

            // 更新瓦片样式
            updateTileStyle(tile.id, !isSelected);

            return newSelectedTiles;
        });
    };

    // 完成选择，创建新子区域
    const finishSelection = () => {
        if (selectedTiles.length === 0) return;

        // 从选中的瓦片生成多边形 - 现在可能返回多个多边形
        const polygons = detectPolygon(selectedTiles, config.tileSize);

        // 生成随机颜色
        const color = generateRandomColor();
        debug("Generated color for new subregion", color);

        // 提取瓦片ID和坐标信息
        const tileInfo = selectedTiles.map(tile => ({
            id: tile.id,
            coords: [tile.x, tile.y] // 存储坐标
        }));

        // 创建新子区域，存储所有检测到的多边形
        const newSubregion = {
            id: `subregion-${subregions.length}`,
            name: `子区域 ${subregions.length}`,
            color,
            tiles: selectedTiles.map(tile => tile.id), // 保持向后兼容
            tileCoords: tileInfo.map(t => t.coords), // 新增坐标数据
            polygon: polygons // 存储所有检测到的多边形
        };

        // 更新瓦片所属关系
        const newTileOwnership = { ...tileOwnership };
        selectedTiles.forEach(tile => {
            if (!newTileOwnership[tile.id]) {
                newTileOwnership[tile.id] = [];
            }

            // 如果只有"未分配"，则先清除它
            if (newTileOwnership[tile.id].length === 1 &&
                newTileOwnership[tile.id][0] === 'unsplit') {
                newTileOwnership[tile.id] = [];
            }

            // 添加新子区域ID
            if (!newTileOwnership[tile.id].includes(newSubregion.id)) {
                newTileOwnership[tile.id].push(newSubregion.id);
            }
        });

        // 存储选中的瓦片，用于后续处理
        const tilesToUpdate = [...selectedTiles];

        // 更新状态，使用回调确保获取更新后的状态
        setTileOwnership(newTileOwnership);
        setSubregions(prev => {
            const updatedSubregions = [...prev, newSubregion];

            // 延迟执行视觉更新，确保状态已更新
            setTimeout(() => {
                // 将子区域引用传递给visualizeSubregion
                visualizeSubregion(newSubregion);

                // 更新选中瓦片的样式
                tilesToUpdate.forEach(tile => {
                    debug(`Updating style for tile ${tile.id}`, newTileOwnership[tile.id]);
                    // 直接使用瓦片引用和新的所有权数据
                    const tileLayer = tileLayersRef.current.tiles[tile.id];
                    if (!tileLayer) return;

                    const subregionIds = newTileOwnership[tile.id] || ['unsplit'];
                    const realSubregions = subregionIds.filter(id => id !== 'unsplit');

                    if (realSubregions.length === 1) {
                        // 如果只属于一个子区域
                        tileLayer.setStyle({
                            color: color, // 使用新创建子区域的颜色
                            weight: 2,
                            opacity: 0.8,
                            fillOpacity: 0.4,
                            fillColor: color
                        });
                    } else if (realSubregions.length > 1) {
                        // 如果属于多个子区域，计算混合颜色
                        const colors = realSubregions.map(id => {
                            if (id === newSubregion.id) return color;
                            const sr = prev.find(s => s.id === id);
                            return sr ? sr.color : '#3388ff';
                        });

                        const blendedColor = blendColors(colors);
                        debug(`Blended colors for tile ${tile.id}`, { colors, blendedColor });

                        tileLayer.setStyle({
                            color: colors[0],
                            weight: 2,
                            opacity: 0.8,
                            fillOpacity: 0.6,
                            fillColor: blendedColor
                        });
                    }
                });
            }, 50); // 给予足够时间让状态更新完成

            return updatedSubregions;
        });

        // 清除选中状态
        setSelectedTiles([]);
    };

    // 将瓦片添加到子区域（不再是转移）
    const transferTileToSubregion = (tileId, targetSubregionId) => {
        debug(`Transferring tile ${tileId} to subregion ${targetSubregionId}`);
        // 找到当前瓦片的坐标
        const tile = tileGrid.find(t => t.id === tileId);
        if (!tile) return;

        const tileCoords = [tile.x, tile.y];

        // 找到目标子区域的颜色
        const targetSubregion = subregions.find(sr => sr.id === targetSubregionId);
        if (!targetSubregion) return;

        const targetColor = targetSubregion.color;

        // 更新瓦片所属关系
        setTileOwnership(prev => {
            const updated = { ...prev };
            if (!updated[tileId]) updated[tileId] = [];

            // 如果只有"未分配"，则清除它
            if (updated[tileId].length === 1 && updated[tileId][0] === 'unsplit') {
                updated[tileId] = [];
            }

            // 添加目标子区域
            if (!updated[tileId].includes(targetSubregionId)) {
                updated[tileId].push(targetSubregionId);
            }

            // 存储更新后的所有权，用于后续处理
            const updatedOwnership = updated[tileId];

            // 延迟执行，确保状态已更新
            setTimeout(() => {
                const tileLayer = tileLayersRef.current.tiles[tileId];
                if (!tileLayer) return;

                const realSubregions = updatedOwnership.filter(id => id !== 'unsplit');

                if (realSubregions.length === 1) {
                    // 如果只属于一个子区域
                    tileLayer.setStyle({
                        color: targetColor,
                        weight: 2,
                        opacity: 0.8,
                        fillOpacity: 0.4,
                        fillColor: targetColor
                    });
                } else if (realSubregions.length > 1) {
                    // 如果属于多个子区域，计算混合颜色
                    const colors = realSubregions.map(id => {
                        const sr = subregions.find(s => s.id === id);
                        return sr ? sr.color : '#3388ff';
                    });

                    const blendedColor = blendColors(colors);

                    tileLayer.setStyle({
                        color: colors[0],
                        weight: 2,
                        opacity: 0.8,
                        fillOpacity: 0.6,
                        fillColor: blendedColor
                    });
                }

                // 更新子区域视觉效果
                updateSubregionVisuals();
            }, 50);

            return updated;
        });

        // 更新子区域
        setSubregions(prev => prev.map(sr => {
            if (sr.id === targetSubregionId) {
                // 确保瓦片未在该子区域中
                if (!sr.tiles.includes(tileId)) {
                    return {
                        ...sr,
                        tiles: [...sr.tiles, tileId],
                        tileCoords: [...(sr.tileCoords || []), tileCoords]
                    };
                }
            }
            return sr;
        }));
    };

    // 可视化子区域
    const visualizeSubregion = (subregion) => {
        if (!map || !subregion.polygon || subregion.polygon.length === 0) return;

        // 对每个多边形分别处理（支持多个闭合圈）
        const polygons = Array.isArray(subregion.polygon[0]) ?
            subregion.polygon : [subregion.polygon];

        polygons.forEach((polygon, index) => {
            // 创建多边形图层
            const maxZoom = config.maxZoom || 2;
            const polygonCoords = polygon.map(point =>
                map.unproject(point, maxZoom)
            );

            const polygonLayer = L.polygon(polygonCoords, {
                color: subregion.color,
                weight: 2,
                opacity: 0.8,
                fillOpacity: 0.3,
                fillColor: subregion.color,
                interactive: false  // 设置为不可交互，允许鼠标事件穿透
            }).addTo(map);

            // 保存引用
            polygonLayersRef.current.push(polygonLayer);

            // 只为主多边形(第一个)添加标签
            if (index === 0) {
                // 找出多边形的左上角点
                let minX = Infinity, minY = Infinity;
                polygon.forEach(point => {
                    if (point[1] < minY || (point[1] === minY && point[0] < minX)) {
                        minX = point[0];
                        minY = point[1];
                    }
                });

                // 计算左上角点的地图坐标
                const labelPoint = map.unproject([minX, minY], maxZoom);

                const label = L.marker(labelPoint, {
                    icon: L.divIcon({
                        className: 'subregion-label',
                        html: `<div style="background-color: white; padding: 3px 8px; border-radius: 4px; font-size: 12px; box-shadow: 0 0 5px rgba(0,0,0,0.2);">${subregion.name}</div>`,
                        iconSize: [80, 20],
                        iconAnchor: [-5, -5] // 左上角定位点
                    }),
                    interactive: false  // 设置为不可交互，允许鼠标事件穿透
                }).addTo(map);

                polygonLayersRef.current.push(label);
            }
        });
    };

    // 更新所有子区域的视觉表示
    const updateSubregionVisuals = () => {
        debug("Updating subregion visuals");

        // 清除现有多边形
        polygonLayersRef.current.forEach(layer => {
            if (map.hasLayer(layer)) {
                map.removeLayer(layer);
            }
        });
        polygonLayersRef.current = [];

        // 重置所有瓦片样式 - 使用基于所属关系的样式
        tileGrid.forEach(tile => {
            updateTileByReign(tile.id);
        });

        // 重新可视化每个子区域的多边形
        subregions.forEach(subregion => {
            if (subregion.id !== 'unsplit') {
                if (subregion.polygon && subregion.polygon.length > 0) {
                    visualizeSubregion(subregion);
                }
            }
        });
    };

    // 重命名子区域
    const renameSubregion = (subregionId, newName) => {
        setSubregions(prev => prev.map(sr =>
            sr.id === subregionId ? { ...sr, name: newName } : sr
        ));

        // 更新视觉效果
        updateSubregionVisuals();
    };

    // 删除子区域
    const deleteSubregion = (subregionId) => {
        const subregion = subregions.find(sr => sr.id === subregionId);
        if (!subregion) return;

        // 保存需要更新的瓦片ID列表，用于后续直接操作
        const tilesToUpdate = [...subregion.tiles];

        // 更新瓦片所属关系
        const newTileOwnership = { ...tileOwnership };
        subregion.tiles.forEach(tileId => {
            if (newTileOwnership[tileId]) {
                // 从所属列表中删除此子区域
                newTileOwnership[tileId] = newTileOwnership[tileId].filter(id => id !== subregionId);

                // 如果没有剩余子区域，重新分配到"未分配"
                if (newTileOwnership[tileId].length === 0) {
                    newTileOwnership[tileId] = ['unsplit'];
                }
            }
        });

        // 如果删除的是当前编辑的区域，清除编辑状态
        if (editingSubregion && editingSubregion.id === subregionId) {
            setEditingSubregion(null);
        }

        // 更新所有权关系 
        setTileOwnership(newTileOwnership);

        // 删除子区域并在状态更新后进行视觉更新
        setSubregions(prev => {
            const updatedSubregions = prev.filter(sr => sr.id !== subregionId);

            // 延迟执行视觉更新，确保状态已更新
            setTimeout(() => {
                debug("Updating visuals after subregion deletion", subregionId);

                // 清除所有多边形视觉效果
                polygonLayersRef.current.forEach(layer => {
                    if (map.hasLayer(layer)) {
                        map.removeLayer(layer);
                    }
                });
                polygonLayersRef.current = [];

                // 直接更新受影响的瓦片样式，不依赖于可能尚未更新的状态
                tilesToUpdate.forEach(tileId => {
                    const tileLayer = tileLayersRef.current.tiles[tileId];
                    if (!tileLayer) return;

                    // 使用已经计算好的最新所有权数据
                    const subregionIds = newTileOwnership[tileId] || ['unsplit'];

                    if (subregionIds.length === 1 && subregionIds[0] === 'unsplit') {
                        // 恢复为未分配状态
                        tileLayer.setStyle({
                            color: '#999',
                            weight: 1,
                            opacity: 0.5,
                            fillOpacity: 0.1,
                            fillColor: '#ccc'
                        });
                    } else {
                        // 瓦片仍然属于其他子区域
                        const realSubregions = subregionIds.filter(id => id !== 'unsplit');

                        if (realSubregions.length === 1) {
                            // 只属于一个子区域
                            const remainingSubregion = updatedSubregions.find(sr => sr.id === realSubregions[0]);
                            if (remainingSubregion) {
                                tileLayer.setStyle({
                                    color: remainingSubregion.color,
                                    weight: 2,
                                    opacity: 0.8,
                                    fillOpacity: 0.4,
                                    fillColor: remainingSubregion.color
                                });
                            }
                        } else if (realSubregions.length > 1) {
                            // 属于多个子区域，混合颜色
                            const colors = realSubregions.map(id => {
                                const sr = updatedSubregions.find(s => s.id === id);
                                return sr ? sr.color : '#3388ff';
                            });

                            const blendedColor = blendColors(colors);
                            debug("Mixing colors for tile after deletion", { tileId, colors, result: blendedColor });

                            tileLayer.setStyle({
                                color: colors[0],
                                weight: 2,
                                opacity: 0.8,
                                fillOpacity: 0.6,
                                fillColor: blendedColor
                            });
                        }
                    }
                });

                // 重新可视化剩余的子区域
                updatedSubregions.forEach(subregion => {
                    if (subregion.id !== 'unsplit' && subregion.polygon && subregion.polygon.length > 0) {
                        visualizeSubregion(subregion);
                    }
                });
            }, 50); // 给React足够的时间更新状态

            return updatedSubregions;
        });
    };

    // 导出子区域数据
    const handleExport = () => {
        // 过滤掉未分配区域
        const exportSubregions = subregions.filter(sr => sr.id !== 'unsplit');

        // 确保每个子区域都有瓦片坐标信息
        const enhancedSubregions = exportSubregions.map(subregion => {
            // 如果已经有tileCoords属性，直接使用
            if (subregion.tileCoords && subregion.tileCoords.length > 0) {
                return subregion;
            }

            // 否则，从tileGrid获取坐标信息
            const tileCoords = subregion.tiles.map(tileId => {
                const tile = tileGrid.find(t => t.id === tileId);
                return tile ? [tile.x, tile.y] : null;
            }).filter(coord => coord !== null);

            return {
                ...subregion,
                tileCoords
            };
        });

        // 记录导出的瓦片坐标信息
        debug("导出子区域瓦片坐标", enhancedSubregions.map(sr => ({
            id: sr.id,
            name: sr.name,
            tileCoords: sr.tileCoords
        })));

        // 格式化导出数据
        const exportData = formatSubregionsForExport(enhancedSubregions, config);

        // 调用导出回调
        if (onExport) {
            onExport(exportData);
        }
    };

    // 取消选择
    const handleCancelSelection = () => {
        // 获取当前选中的瓦片列表
        const tilesToReset = [...selectedTiles];

        // 重置所有选中瓦片的样式
        tilesToReset.forEach(tile => {
            updateTileByReign(tile.id);
        });

        // 清空选择
        setSelectedTiles([]);
    };

    return (
        <div className="subregion-editor">
            <div className="subregion-editor-header">
                <h3 className="title">子区域编辑器</h3>
                <button className="close-btn" onClick={onClose}>&times;</button>
            </div>

            <div className="subregion-editor-content">
                <div className="instructions">
                    点击瓦片选择区域，<strong>按住Command(⌘)+左键拖动</strong>可多选，然后点击"创建子区域"按钮。已创建的子区域可以重命名和删除。瓦片可同时属于多个子区域，会显示混合颜色效果。
                </div>

                <div className="subregion-actions">
                    <button
                        className="button primary"
                        onClick={finishSelection}
                        disabled={selectedTiles.length === 0}
                    >
                        创建子区域
                    </button>

                    <button
                        className="button"
                        onClick={handleCancelSelection}
                        disabled={selectedTiles.length === 0}
                    >
                        取消选择
                    </button>
                </div>

                <div className="subregion-list">
                    <div className="subregion-list-title">已创建的子区域</div>
                    <div className="subregion-list-items">
                        {subregions.filter(sr => sr.id !== 'unsplit').map(subregion => (
                            <div
                                key={subregion.id}
                                className={`subregion-item ${editingSubregion?.id === subregion.id ? 'active' : ''}`}
                                onClick={() => setEditingSubregion(
                                    editingSubregion?.id === subregion.id ? null : subregion
                                )}
                            >
                                <div
                                    className="color-sample"
                                    style={{ backgroundColor: subregion.color }}
                                ></div>
                                <div className="subregion-name">{subregion.name}</div>
                                <div className="tile-count">{subregion.tiles.length}瓦片</div>
                            </div>
                        ))}

                        {subregions.filter(sr => sr.id !== 'unsplit').length === 0 && (
                            <div className="subregion-item">
                                <div className="subregion-name">尚未创建子区域</div>
                            </div>
                        )}
                    </div>
                </div>

                {editingSubregion && (
                    <div className="form-group">
                        <label htmlFor="subregion-name">重命名区域</label>
                        <input
                            type="text"
                            id="subregion-name"
                            value={editingSubregion.name}
                            onChange={(e) => {
                                const newName = e.target.value;
                                setEditingSubregion({ ...editingSubregion, name: newName });
                                renameSubregion(editingSubregion.id, newName);
                            }}
                        />
                        <button
                            className="button"
                            style={{ marginTop: '8px' }}
                            onClick={() => deleteSubregion(editingSubregion.id)}
                        >
                            删除此区域
                        </button>
                    </div>
                )}

                <div className="unsplit-notification">
                    未选择的瓦片将作为"未分配区域"保留
                </div>
            </div>

            <div className="subregion-editor-footer">
                <button className="button" onClick={onClose}>
                    取消
                </button>
                <button
                    className="button primary"
                    onClick={handleExport}
                    disabled={subregions.filter(sr => sr.id !== 'unsplit').length === 0}
                >
                    导出子区域数据
                </button>
            </div>
        </div>
    );
};

export default SubregionEditor;