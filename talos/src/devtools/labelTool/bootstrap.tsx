/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { createRoot, type Root } from 'react-dom/client';
import styles from './labelTool.module.scss';
import useRegion from '@/store/region';
import { DEFAULT_REGION, REGION_DICT } from '@/data/map';
import { serializeLabelData } from '@/data/map/label';
import type { AnyLabel } from '@/data/map/label/types';
import { mapRegionKeyToLocaleCode } from '@/data/map/label/placeIndex';
import { usePlaceIndex, type PlaceItem } from './placeIndex';
import { selectLabelMapForRegion, useLabelStore } from '@/store/label';
import { useTriggerlabelName } from '@/store/uiPrefs';

const ZOOM_THRESHOLD = 0.25;

const ensurePane = (map: L.Map, name: string, zIndex: number) => {
    const existing = map.getPane(name);
    if (existing) return;
    const pane = map.createPane(name);
    pane.style.zIndex = String(zIndex);
};

const makeDivIcon = (text: string, type: 'sub' | 'site') => {
    const safe = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const cls = type === 'site' ? styles.mapLabelSite : styles.mapLabel;
    return L.divIcon({
        className: '',
        html: `<div class="${cls}" draggable="false">${safe}</div>`,
        iconSize: [0, 0],
    });
};

const isOverElement = (el: HTMLElement, x: number, y: number): boolean => {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
};

export const LabelTool: React.FC<{ map: L.Map }> = ({ map }) => {
    const currentRegionKey = useRegion((s) => s.currentRegionKey) ?? DEFAULT_REGION;
    const regionCode = useMemo(() => mapRegionKeyToLocaleCode(currentRegionKey), [currentRegionKey]);
    const maxZoom = REGION_DICT[currentRegionKey]?.maxZoom ?? REGION_DICT[DEFAULT_REGION].maxZoom;

    const [collapsed, setCollapsed] = useState(false);
    const [zoom, setZoom] = useState(() => map.getZoom());
    const [importText, setImportText] = useState('');
    const [importError, setImportError] = useState<string | null>(null);

    const store = useLabelStore();
    const showRegionLabels = useTriggerlabelName();
    const labelMap = useLabelStore(useMemo(() => (regionCode ? selectLabelMapForRegion(regionCode) : () => undefined), [regionCode]));
    const labels = useMemo(() => (labelMap ? Object.values(labelMap) : []), [labelMap]);
    const data = useLabelStore((s) => s.current);

    const places = usePlaceIndex(regionCode ?? '');
    const hasSubLevel = useMemo(() => places.some((p) => p.kind === 'sub'), [places]);
    // Special-case regions without sub-level (e.g. DJ): always place sites
    const allowedKind = hasSubLevel ? (zoom <= ZOOM_THRESHOLD ? 'sub' : 'site') : 'site';

    const idToPlace = useMemo(() => {
        const m = new Map<string, PlaceItem>();
        for (const p of places) m.set(p.id, p);
        return m;
    }, [places]);

    const assigned = useMemo(() => {
        if (!regionCode) return new Set<string>();
        const bucket = data.regions[regionCode];
        return new Set(Object.keys(bucket?.labels ?? {}));
    }, [data, regionCode]);

    const unassigned = useMemo(() => {
        if (!regionCode) return [];
        return places.filter((p) => p.kind === allowedKind && !assigned.has(p.id));
    }, [places, assigned, allowedKind, regionCode]);

    const assignedCurrentMode = useMemo(() => {
        if (!regionCode) return [];
        const showType: AnyLabel['type'] = hasSubLevel ? (zoom <= ZOOM_THRESHOLD ? 'sub' : 'site') : 'site';
        return labels
            .filter((l) => l.type === showType)
            .map((l) => ({ label: l, place: idToPlace.get(l.id) }))
            .sort((a, b) => (a.place?.label ?? a.label.id).localeCompare(b.place?.label ?? b.label.id));
    }, [labels, idToPlace, regionCode, zoom, hasSubLevel]);

    // Drag state
    const [dragging, setDragging] = useState<PlaceItem | null>(null);
    const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);

    const previewMarkerRef = useRef<L.Marker | null>(null);
    const editLayerRef = useRef<L.LayerGroup | null>(null);

    useEffect(() => {
        const onZoom = () => setZoom(map.getZoom());
        map.on('zoomend', onZoom);
        return () => {
            map.off('zoomend', onZoom);
        };
    }, [map]);

    // Undo/redo hotkeys: Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const isMod = e.metaKey || e.ctrlKey;
            if (!isMod) return;
            if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
                e.preventDefault();
                store.undo();
            } else if (e.key.toLowerCase() === 'z' && e.shiftKey) {
                e.preventDefault();
                store.redo();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [store]);

    // Tool layers
    useEffect(() => {
        ensurePane(map, 'talos-label-tool-preview', 800);
        ensurePane(map, 'talos-label-tool-edit', 801);

        if (!editLayerRef.current) {
            editLayerRef.current = L.layerGroup([], { pane: 'talos-label-tool-edit' });
        }

        // MapCore clears layers when switching region; re-add ours if needed.
        if (editLayerRef.current && !map.hasLayer(editLayerRef.current)) {
            editLayerRef.current.addTo(map);
        }

        const onRegionSwitched = () => {
            if (editLayerRef.current && !map.hasLayer(editLayerRef.current)) {
                editLayerRef.current.addTo(map);
            }
        };

        map.on('talos:regionSwitched', onRegionSwitched);

        return () => {
            map.off('talos:regionSwitched', onRegionSwitched);
            editLayerRef.current?.remove();
            editLayerRef.current = null;

            previewMarkerRef.current?.remove();
            previewMarkerRef.current = null;
        };
    }, [map, currentRegionKey]);

    // Rebuild draggable markers when draft/zoom/region changes
    useEffect(() => {
        if (!regionCode || !editLayerRef.current) return;

        if (!showRegionLabels) {
            editLayerRef.current.clearLayers();
            previewMarkerRef.current?.remove();
            previewMarkerRef.current = null;
            return;
        }
        const showType: AnyLabel['type'] = hasSubLevel ? (zoom <= ZOOM_THRESHOLD ? 'sub' : 'site') : 'site';

        editLayerRef.current.clearLayers();
        for (const label of labels) {
            if (label.type !== showType) continue;
            const [x, y] = label.point;
            const latLng = map.unproject([x, y], maxZoom);
            const place = idToPlace.get(label.id);
            const text = place?.label ?? (label.type === 'site' ? label.site : label.sub);

            const m = L.marker(latLng, {
                pane: 'talos-label-tool-edit',
                draggable: true,
                icon: makeDivIcon(text, label.type),
            });
            m.on('dragend', () => {
                const ll = m.getLatLng();
                const pt = map.project(ll, maxZoom);
                // Leaflet draggable can fire dragend on click; avoid no-op updates.
                const [ox, oy] = label.point;
                if (Math.abs(pt.x - ox) < 0.01 && Math.abs(pt.y - oy) < 0.01) return;
                store.upsertLabel({ ...label, point: [pt.x, pt.y] } as AnyLabel);
            });
            editLayerRef.current.addLayer(m);
        }
    }, [labels, regionCode, zoom, map, maxZoom, store, idToPlace, hasSubLevel, showRegionLabels]);

    // Global drag listeners
    useEffect(() => {
        if (!dragging) return;

        const mapEl = document.getElementById('map');
        if (!mapEl) return;

        const move = (e: MouseEvent) => {
            setGhostPos({ x: e.clientX, y: e.clientY });

            if (!isOverElement(mapEl, e.clientX, e.clientY)) {
                previewMarkerRef.current?.remove();
                previewMarkerRef.current = null;
                return;
            }

            const latLng = map.mouseEventToLatLng(e as unknown as MouseEvent);
            if (!previewMarkerRef.current) {
                previewMarkerRef.current = L.marker(latLng, {
                    pane: 'talos-label-tool-preview',
                    interactive: false,
                    icon: makeDivIcon(dragging.label, dragging.kind === 'site' ? 'site' : 'sub'),
                }).addTo(map);
            } else {
                previewMarkerRef.current.setLatLng(latLng);
            }
        };

        const up = (e: MouseEvent) => {
            const overMap = isOverElement(mapEl, e.clientX, e.clientY);
            if (overMap && regionCode) {
                const latLng = map.mouseEventToLatLng(e as unknown as MouseEvent);
                const pt = map.project(latLng, maxZoom);

                if (dragging.kind === 'sub') {
                    store.upsertLabel({
                        id: dragging.id,
                        type: 'sub',
                        region: regionCode,
                        sub: dragging.sub,
                        point: [pt.x, pt.y],
                    });
                } else if (dragging.kind === 'site' && dragging.site) {
                    store.upsertLabel({
                        id: dragging.id,
                        type: 'site',
                        region: regionCode,
                        sub: dragging.sub,
                        site: dragging.site,
                        point: [pt.x, pt.y],
                    });
                }
            }

            previewMarkerRef.current?.remove();
            previewMarkerRef.current = null;
            setDragging(null);
            setGhostPos(null);
        };

        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
        return () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };
    }, [dragging, map, regionCode, maxZoom, store]);

    const exportText = useMemo(() => serializeLabelData(data), [data]);

    const doImportMerge = () => {
        setImportError(null);
        const ok = store.importMerge(importText);
        if (!ok) {
            setImportError('Invalid JSON / version mismatch');
            return;
        }
        setImportText('');
    };

    if (!regionCode) {
        return (
            <div className={styles.root}>
                <div className={styles.header}>
                    <div className={styles.title}>Label Tool</div>
                </div>
                <div className={styles.body}>Unknown region mapping for: {currentRegionKey}</div>
            </div>
        );
    }

    return (
        <div className={`${styles.root} ${collapsed ? styles.collapsed : ''}`}>
            <div className={styles.header}>
                <div className={styles.title}>{collapsed ? 'LT' : `Label Tool (${regionCode})`}</div>
                <button className={styles.btn} onClick={() => setCollapsed((v) => !v)}>
                    {collapsed ? '>' : '<'}
                </button>
            </div>

            {!collapsed && (
                <div className={styles.body}>
                    <div className={styles.section}>
                        <div className={styles.sectionTitle}>Mode</div>
                        <div>
                            zoom={zoom} → placing <b>{allowedKind}</b>
                        </div>
                        <div className={styles.small}>
                            Rule: zoom≤0.5 shows sub labels; zoom&gt;0.5 shows site labels.
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            <button className={styles.btn} onClick={() => store.undo()}>
                                Undo
                            </button>
                            <button className={styles.btn} onClick={() => store.redo()}>
                                Redo
                            </button>
                        </div>
                    </div>

                    <div className={styles.section}>
                        <div className={styles.sectionTitle}>Unassigned ({unassigned.length})</div>
                        <div className={styles.list}>
                            {unassigned.map((p) => (
                                <div
                                    key={p.id}
                                    className={styles.item}
                                    onMouseDown={() => {
                                        setDragging(p);
                                        setGhostPos(null);
                                    }}
                                >
                                    {p.label}
                                    <div className={styles.small}>{p.id}</div>
                                </div>
                            ))}
                        </div>
                        <div className={styles.small}>Drag an item onto the map to bind coordinates.</div>
                    </div>

                    <div className={styles.section}>
                        <div className={styles.sectionTitle}>Assigned ({assignedCurrentMode.length})</div>
                        <div className={styles.list}>
                            {assignedCurrentMode.map(({ label, place }) => (
                                <div key={label.id} className={styles.assignedRow}>
                                    <div className={styles.assignedName}>{place?.label ?? label.id}</div>
                                    <button
                                        className={styles.btn}
                                        onClick={() => {
                                            if (!regionCode) return;
                                            store.removeLabel(regionCode, label.id);
                                        }}
                                    >
                                        Remove
                                    </button>
                                </div>
                            ))}
                        </div>
                        <div className={styles.small}>Remove returns it to Unassigned.</div>
                    </div>

                    <div className={styles.section}>
                        <div className={styles.sectionTitle}>Export</div>
                        <textarea className={styles.textarea} value={exportText} readOnly />
                    </div>

                    <div className={styles.section}>
                        <div className={styles.sectionTitle}>Import (merge)</div>
                        <textarea
                            className={styles.textarea}
                            value={importText}
                            onChange={(e) => setImportText(e.target.value)}
                            placeholder='Paste LabelDataV1 JSON here'
                        />
                        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                            <button className={styles.btn} onClick={doImportMerge}>
                                Merge
                            </button>
                            {importError && <div className={styles.small}>{importError}</div>}
                        </div>
                    </div>
                </div>
            )}

            {dragging && ghostPos && (
                <div className={styles.ghost} style={{ left: ghostPos.x, top: ghostPos.y }}>
                    {dragging.label}
                </div>
            )}
        </div>
    );
};

let toolRoot: Root | null = null;

export const bootstrapLabelTool = (map: L.Map): void => {
    if (document.getElementById('talos-label-tool-root')) return;

    const container = document.createElement('div');
    container.id = 'talos-label-tool-root';
    document.body.appendChild(container);

    toolRoot = createRoot(container);
    toolRoot.render(<LabelTool map={map} />);
    map.fire('talos:labelToolMounted');
};

export const unmountLabelTool = (): void => {
    if (toolRoot) {
        toolRoot.unmount();
        toolRoot = null;
    }
    const container = document.getElementById('talos-label-tool-root');
    if (container) container.remove();
};
