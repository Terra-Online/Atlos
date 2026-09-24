/* eslint-disable react-refresh/only-export-components */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { createRoot, type Root } from 'react-dom/client';

import { REGION_DICT, type IMapRegion } from '@/data/map';
import useRegion from '@/store/region';
import { detectPolygon, type TileCoordinate } from './polygonDetector';
import styles from './splitTool.module.scss';

interface Tile { id: string; x: number; y: number; }
type TileLayer = L.Rectangle & { _tileIdX: number; _tileIdY: number };
interface Subregion {
    id: string;
    name: string;
    color: string;
    tiles: string[];
    tileCoords: TileCoordinate[];
    polygon: number[][][];
}

const cloneBounds = (bounds: L.LatLngBounds): L.LatLngBounds => L.latLngBounds(bounds.getSouthWest(), bounds.getNorthEast());

const randomColor = (() => {
    let hue = Math.random() * 360;
    return () => {
        hue = (hue + 137.508) % 360;
        return `hsl(${hue.toFixed(1)} 72% 52%)`;
    };
})();

const blendColors = (colors: string[]): string => {
    if (!colors.length) return '#8d98a8';
    const hues = colors.map((color) => Number(color.match(/hsl\(([-\d.]+)/)?.[1])).filter(Number.isFinite);
    if (!hues.length) return colors[0];
    return `hsl(${(hues.reduce((sum, hue) => sum + hue, 0) / hues.length).toFixed(1)} 72% 52%)`;
};

const exportSubregions = (subregions: Subregion[], config: IMapRegion) => subregions.map((subregion) => {
    const coords = subregion.tileCoords;
    const xs = coords.map(([x]) => x);
    const ys = coords.map(([, y]) => y);
    const bounds = xs.length
        ? [[Math.min(...xs) * config.tileSize, Math.min(...ys) * config.tileSize], [(Math.max(...xs) + 1) * config.tileSize, (Math.max(...ys) + 1) * config.tileSize]]
        : undefined;
    return { id: subregion.id, name: subregion.name, ...(bounds ? { bounds } : {}), polygon: subregion.polygon };
});

const SplitTool: React.FC<{ map: L.Map }> = ({ map }) => {
    const regionKey = useRegion((state) => state.currentRegionKey);
    const config = REGION_DICT[regionKey] ?? REGION_DICT.Valley_4;
    const [tiles, setTiles] = useState<Tile[]>([]);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [subregions, setSubregions] = useState<Subregion[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [collapsed, setCollapsed] = useState(false);
    const layerRef = useRef<L.LayerGroup | null>(null);
    const polygonLayerRef = useRef<L.LayerGroup | null>(null);
    const tileLayersRef = useRef<Record<string, TileLayer>>({});
    const selectedRef = useRef(new Set<string>());
    const activeRef = useRef<string | null>(null);
    const selectingRef = useRef(false);
    const boundsRef = useRef<L.LatLngBounds | null>(null);

    const updateSelection = useCallback((id: string) => {
        const active = activeRef.current;
        if (active) {
            setSubregions((current) => current.map((subregion) => {
                if (subregion.id !== active || subregion.tiles.includes(id)) return subregion;
                const tile = tileLayersRef.current[id];
                const tileCoords: TileCoordinate[] = [...subregion.tileCoords, [tile?._tileIdX ?? 0, tile?._tileIdY ?? 0]];
                return { ...subregion, tiles: [...subregion.tiles, id], tileCoords, polygon: detectPolygon(tileCoords.map(([x, y]) => ({ x, y })), config.tileSize) };
            }));
            return;
        }
        setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    }, [config.tileSize]);

    useEffect(() => { selectedRef.current = new Set(selectedIds); }, [selectedIds]);
    useEffect(() => { activeRef.current = activeId; }, [activeId]);

    useEffect(() => {
        const removeBounds = () => {
            const bounds = map.options.maxBounds;
            if (bounds instanceof L.LatLngBounds) boundsRef.current = cloneBounds(bounds);
            map.setMaxBounds(null as unknown as L.LatLngBoundsExpression);
        };
        removeBounds();
        const onRegionSwitched = () => removeBounds();
        map.on('talos:regionSwitched', onRegionSwitched);
        return () => {
            map.off('talos:regionSwitched', onRegionSwitched);
            map.dragging.enable();
            if (boundsRef.current) map.setMaxBounds(boundsRef.current);
        };
    }, [map]);

    useEffect(() => {
        setSelectedIds([]);
        setSubregions([]);
        setActiveId(null);
        tileLayersRef.current = {};
        layerRef.current?.remove();
        polygonLayerRef.current?.remove();

        const nextTiles: Tile[] = [];
        const grid = L.layerGroup().addTo(map);
        const polygonLayer = L.layerGroup().addTo(map);
        const width = Math.ceil(config.dimensions[0] / config.tileSize);
        const height = Math.ceil(config.dimensions[1] / config.tileSize);
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const tile = { id: `tile-${x}-${y}`, x, y };
                const sw = map.unproject([x * config.tileSize, (y + 1) * config.tileSize], config.maxZoom);
                const ne = map.unproject([(x + 1) * config.tileSize, y * config.tileSize], config.maxZoom);
                const rectangle = L.rectangle(L.latLngBounds(sw, ne), { color: '#8d98a8', weight: 1, opacity: 0.45, fillColor: '#8d98a8', fillOpacity: 0.08 });
                const rectangleWithCoords = rectangle as TileLayer;
                rectangleWithCoords._tileIdX = x;
                rectangleWithCoords._tileIdY = y;
                rectangle.on('click', (event) => { L.DomEvent.stopPropagation(event); updateSelection(tile.id); });
                rectangle.on('mouseover', () => { if (selectingRef.current) updateSelection(tile.id); });
                rectangle.addTo(grid);
                tileLayersRef.current[tile.id] = rectangleWithCoords;
                nextTiles.push(tile);
            }
        }
        layerRef.current = grid;
        polygonLayerRef.current = polygonLayer;
        setTiles(nextTiles);
        map.setZoom(config.maxZoom);
        return () => { grid.remove(); polygonLayer.remove(); };
    }, [config, map, regionKey, updateSelection]);

    useEffect(() => {
        const ownership = new Map<string, string[]>();
        subregions.forEach((subregion) => subregion.tiles.forEach((id) => ownership.set(id, [...(ownership.get(id) ?? []), subregion.id])));
        tiles.forEach((tile) => {
            const layer = tileLayersRef.current[tile.id];
            if (!layer) return;
            const owners = ownership.get(tile.id) ?? [];
            const colors = owners.map((id) => subregions.find((item) => item.id === id)?.color).filter((color): color is string => Boolean(color));
            const selected = selectedRef.current.has(tile.id);
            layer.setStyle({ color: selected ? '#5ca9ff' : colors[0] ?? '#8d98a8', weight: selected || colors.length ? 2 : 1, fillColor: selected ? '#5ca9ff' : blendColors(colors), fillOpacity: selected ? 0.48 : colors.length ? 0.36 : 0.08 });
        });
    }, [selectedIds, subregions, tiles]);

    useEffect(() => {
        const layer = polygonLayerRef.current;
        if (!layer) return;
        layer.clearLayers();
        subregions.forEach((subregion) => {
            if (!subregion.polygon.length) return;
            L.polygon(subregion.polygon.map((ring) => ring.map(([x, y]) => map.unproject([x, y], config.maxZoom))), { color: subregion.color, weight: 2, fillColor: subregion.color, fillOpacity: 0.16, interactive: false }).addTo(layer);
        });
    }, [config.maxZoom, map, subregions]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => { if (event.metaKey || event.ctrlKey) selectingRef.current = true; };
        const onKeyUp = (event: KeyboardEvent) => { if (event.key === 'Meta' || event.key === 'Control') { selectingRef.current = false; map.dragging.enable(); } };
        const onMouseDown = (event: MouseEvent) => {
            if (!map.getContainer().contains(event.target as Node) || (!event.metaKey && !event.ctrlKey)) return;
            selectingRef.current = true;
            map.dragging.disable();
        };
        const onMouseUp = () => { selectingRef.current = false; map.dragging.enable(); };
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mouseup', onMouseUp);
        return () => { document.removeEventListener('keydown', onKeyDown); document.removeEventListener('keyup', onKeyUp); document.removeEventListener('mousedown', onMouseDown); document.removeEventListener('mouseup', onMouseUp); map.dragging.enable(); };
    }, [map]);

    const selectedTiles = useMemo(() => tiles.filter((tile) => selectedIds.includes(tile.id)), [selectedIds, tiles]);
    const createSubregion = () => {
        if (!selectedTiles.length) return;
        const index = subregions.length;
        const next: Subregion = { id: `subregion-${index}`, name: `子区域 ${index + 1}`, color: randomColor(), tiles: selectedTiles.map((tile) => tile.id), tileCoords: selectedTiles.map(({ x, y }) => [x, y]), polygon: detectPolygon(selectedTiles, config.tileSize) };
        setSubregions((current) => [...current, next]);
        setSelectedIds([]);
    };
    const deleteSubregion = (id: string) => { setSubregions((current) => current.filter((item) => item.id !== id)); if (activeId === id) setActiveId(null); };
    const exportData = useMemo(() => exportSubregions(subregions, config), [config, subregions]);
    const download = () => {
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${regionKey}_subregions.json`;
        anchor.click();
        URL.revokeObjectURL(url);
    };

    return <div className={styles.root}>
        <div className={styles.header}>
            <div><div className={styles.title}>Split Tool</div><div className={styles.meta}>{regionKey} · {tiles.length} tiles</div></div>
            <div className={styles.toolbar}>
                <button className={styles.close} onClick={() => unmountSplitTool()} aria-label='Close split tool'>×</button>
                <button className={styles.close} onClick={() => setCollapsed((value) => !value)} aria-label='Collapse split tool'>{collapsed ? '+' : '−'}</button>
            </div>
        </div>
        {!collapsed && <>
            <div className={styles.body}>
                <div className={styles.hint}>Click tiles to select. Hold Cmd/Ctrl and drag to select multiple tiles.</div>
                <div className={styles.toolbar}>
                    <button className={`${styles.button} ${styles.primary}`} onClick={createSubregion} disabled={!selectedTiles.length}>Create ({selectedTiles.length})</button>
                    <button className={styles.button} onClick={() => setSelectedIds([])} disabled={!selectedTiles.length}>Clear</button>
                </div>
                <div className={styles.meta}>Created subregions</div>
                <div className={styles.list}>
                    {subregions.map((subregion) => <div key={subregion.id} className={`${styles.item} ${activeId === subregion.id ? styles.active : ''}`} onClick={() => setActiveId((current) => current === subregion.id ? null : subregion.id)}>
                        <span className={styles.swatch} style={{ background: subregion.color }} />
                        <span className={styles.itemName}>{subregion.name}</span>
                        <span className={styles.meta}>{subregion.tiles.length}</span>
                    </div>)}
                    {!subregions.length && <div className={styles.empty}>No subregions yet</div>}
                </div>
                {activeId && <>
                    <div className={styles.row}><label htmlFor='split-name'>Name</label><input id='split-name' className={styles.input} value={subregions.find((item) => item.id === activeId)?.name ?? ''} onChange={(event) => setSubregions((current) => current.map((item) => item.id === activeId ? { ...item, name: event.target.value } : item))} /></div>
                    <button className={styles.button} onClick={() => deleteSubregion(activeId)}>Delete selected</button>
                    <div className={styles.hint}>With a subregion selected, clicking tiles adds them to it.</div>
                </>}
                <div className={styles.row}><label htmlFor='split-preview'>JSON</label></div>
                <textarea id='split-preview' className={styles.textarea} value={JSON.stringify(exportData, null, 2)} readOnly />
            </div>
            <div className={styles.footer}><button className={`${styles.button} ${styles.primary}`} onClick={download} disabled={!exportData.length}>Export JSON</button></div>
        </>}
    </div>;
};

let toolRoot: Root | null = null;
export const bootstrapSplitTool = (map: L.Map): void => {
    if (document.getElementById('talos-split-tool-root')) return;
    const container = document.createElement('div');
    container.id = 'talos-split-tool-root';
    document.body.appendChild(container);
    toolRoot = createRoot(container);
    toolRoot.render(<SplitTool map={map} />);
};

export const unmountSplitTool = (): void => {
    toolRoot?.unmount();
    toolRoot = null;
    document.getElementById('talos-split-tool-root')?.remove();
};
