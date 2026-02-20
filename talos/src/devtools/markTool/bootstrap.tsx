/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { createRoot, type Root } from 'react-dom/client';

import { MARKER_TYPE_DICT } from '@/data/marker';
import { getItemIconUrl } from '@/utils/resource';
import useRegion from '@/store/region';

import styles from './markTool.module.scss';

interface MarkerTypeOption {
    key: string;
    name?: string;
    noFrame?: boolean;
}

interface DraftMarker {
    position: [number, number];
    subregionId: string;
    type: string;
}

type RegionMarkers = Record<string, DraftMarker[]>;

const round = (value: number): number => Math.round(value * 10_000) / 10_000;

const typeOptions: MarkerTypeOption[] = Object.values(MARKER_TYPE_DICT as Record<string, MarkerTypeOption>)
    .map((item) => ({ key: item.key, name: item.name, noFrame: item.noFrame }))
    .sort((a, b) => (a.name ?? a.key).localeCompare(b.name ?? b.key));

const createMarkerIcon = (type: string, noFrame?: boolean): L.Icon => {
    const iconUrl = getItemIconUrl(type, 'webp');
    const iconSize = noFrame ? 44 : 32;
    const iconAnchor = iconSize / 2;

    return L.icon({
        iconUrl,
        iconSize: [iconSize, iconSize],
        iconAnchor: [iconAnchor, iconAnchor],
        className: '',
    });
};

const MarkTool: React.FC<{ map: L.Map }> = ({ map }) => {
    const currentRegionKey = useRegion((s) => s.currentRegionKey);
    const currentSubregionKey = useRegion((s) => s.currentSubregionKey);

    const [selectedType, setSelectedType] = useState<string>(typeOptions[0]?.key ?? '');
    const [subregionId, setSubregionId] = useState<string>(currentSubregionKey ?? '');
    const [markersByRegion, setMarkersByRegion] = useState<RegionMarkers>({});
    const [collapsed, setCollapsed] = useState<boolean>(false);

    const layerRef = useRef<L.LayerGroup | null>(null);

    useEffect(() => {
        if (currentSubregionKey) {
            setSubregionId(currentSubregionKey);
        }
    }, [currentSubregionKey, currentRegionKey]);

    const currentRegion = currentRegionKey ?? '';
    const currentMarkers = useMemo(() => {
        if (!currentRegion) return [];
        return markersByRegion[currentRegion] ?? [];
    }, [markersByRegion, currentRegion]);

    useEffect(() => {
        if (!layerRef.current) {
            layerRef.current = L.layerGroup().addTo(map);
        }

        const onRegionSwitched = () => {
            const layer = layerRef.current;
            if (layer && !map.hasLayer(layer)) {
                layer.addTo(map);
            }
        };

        map.on('talos:regionSwitched', onRegionSwitched);

        return () => {
            map.off('talos:regionSwitched', onRegionSwitched);
            if (layerRef.current) {
                layerRef.current.remove();
                layerRef.current = null;
            }
        };
    }, [map]);

    useEffect(() => {
        const layer = layerRef.current;
        if (!layer) return;

        layer.clearLayers();
        currentMarkers.forEach((marker, index) => {
            const typeInfo = MARKER_TYPE_DICT[marker.type] as MarkerTypeOption | undefined;
            const icon = createMarkerIcon(marker.type, typeInfo?.noFrame);
            const leafletMarker = L.marker([marker.position[0], marker.position[1]], {
                icon,
                alt: marker.type,
            });

            leafletMarker.on('click', (e: L.LeafletMouseEvent) => {
                e.originalEvent.stopPropagation();
                if (!currentRegion) return;
                setMarkersByRegion((prev) => ({
                    ...prev,
                    [currentRegion]: (prev[currentRegion] ?? []).filter((_, i) => i !== index),
                }));
            });

            layer.addLayer(leafletMarker);
        });
    }, [currentMarkers, currentRegion]);

    useEffect(() => {
        const handleMapClick = (e: L.LeafletMouseEvent) => {
            if (!currentRegion) return;
            const trimmedSubregion = subregionId.trim();
            if (!selectedType || !trimmedSubregion) return;

            const clickPoint = map.latLngToContainerPoint(e.latlng);

            setMarkersByRegion((prev) => {
                const regionMarkers = prev[currentRegion] ?? [];
                const hitIndex = regionMarkers.findIndex((item) => {
                    const markerPoint = map.latLngToContainerPoint(L.latLng(item.position[0], item.position[1]));
                    return markerPoint.distanceTo(clickPoint) <= 10;
                });

                if (hitIndex >= 0) {
                    return {
                        ...prev,
                        [currentRegion]: regionMarkers.filter((_, index) => index !== hitIndex),
                    };
                }

                return {
                    ...prev,
                    [currentRegion]: [
                        ...regionMarkers,
                        {
                            position: [round(e.latlng.lat), round(e.latlng.lng)],
                            subregionId: trimmedSubregion,
                            type: selectedType,
                        },
                    ],
                };
            });
        };

        map.on('click', handleMapClick);
        return () => {
            map.off('click', handleMapClick);
        };
    }, [map, selectedType, subregionId, currentRegion]);

    const exportData = useMemo(
        () => currentMarkers.map((item) => ({ position: item.position, subregionId: item.subregionId, type: item.type })),
        [currentMarkers],
    );

    const exportText = useMemo(() => JSON.stringify(exportData, null, 2), [exportData]);

    const selectedTypeInfo = MARKER_TYPE_DICT[selectedType] as MarkerTypeOption | undefined;
    const selectedPreviewUrl = selectedType ? getItemIconUrl(selectedType, 'webp') : '';

    const handleExportByRegion = () => {
        const entries = Object.entries(markersByRegion).filter(([, list]) => list.length > 0);
        entries.forEach(([region, list], idx) => {
            const payload = list.map((item) => ({ position: item.position, subregionId: item.subregionId, type: item.type }));
            const text = JSON.stringify(payload, null, 2);
            const blob = new Blob([text], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `mark-tool-${region}.json`;
            window.setTimeout(() => {
                anchor.click();
                URL.revokeObjectURL(url);
            }, idx * 100);
        });
    };

    return (
        <div className={`${styles.root} ${collapsed ? styles.collapsed : ''}`}>
            <div className={styles.header}>
                <div>
                    <div className={styles.title}>{collapsed ? 'MT' : 'Manual Mark Tool'}</div>
                    {!collapsed && <div className={styles.region}>Region: {currentRegionKey ?? 'N/A'}</div>}
                </div>
                {!collapsed && <div className={styles.region}>Count: {currentMarkers.length}</div>}
                <button className={styles.collapseBtn} onClick={() => setCollapsed((v) => !v)}>
                    {collapsed ? '<' : '>'}
                </button>
            </div>

            {!collapsed && <div className={styles.body}>
                <div className={styles.row}>
                    <label className={styles.label}>Type</label>
                    <select
                        className={styles.select}
                        value={selectedType}
                        onChange={(e) => setSelectedType(e.target.value)}
                    >
                        {typeOptions.map((option) => (
                            <option key={option.key} value={option.key}>
                                {(option.name ?? option.key) + ` (${option.key})`}
                            </option>
                        ))}
                    </select>
                </div>

                <div className={styles.previewWrap}>
                    {selectedPreviewUrl && <img className={styles.preview} src={selectedPreviewUrl} alt={selectedType} />}
                    <div className={styles.hint}>{selectedTypeInfo?.name ?? selectedType}</div>
                </div>

                <div className={styles.row}>
                    <label className={styles.label}>Subregion ID</label>
                    <input
                        className={styles.input}
                        value={subregionId}
                        onChange={(e) => setSubregionId(e.target.value)}
                        placeholder='e.g. VL_1'
                    />
                </div>

                <div className={styles.hint}>Click map to add marker. Click marker (or nearby marker position) again to remove.</div>

                <div className={styles.toolbar}>
                    <button
                        className={styles.btn}
                        onClick={() => {
                            if (!currentRegion) return;
                            setMarkersByRegion((prev) => ({ ...prev, [currentRegion]: [] }));
                        }}
                    >
                        Clear All
                    </button>
                    <button className={styles.btn} onClick={handleExportByRegion}>
                        Export By Region
                    </button>
                </div>

                <div className={styles.row}>
                    <label className={styles.label}>Preview JSON</label>
                    <textarea className={styles.textarea} value={exportText} readOnly />
                </div>
            </div>}
        </div>
    );
};

let toolRoot: Root | null = null;

export const bootstrapMarkTool = (map: L.Map): void => {
    if (document.getElementById('talos-mark-tool-root')) return;

    const container = document.createElement('div');
    container.id = 'talos-mark-tool-root';
    document.body.appendChild(container);

    toolRoot = createRoot(container);
    toolRoot.render(<MarkTool map={map} />);
};

export const unmountMarkTool = (): void => {
    if (toolRoot) {
        toolRoot.unmount();
        toolRoot = null;
    }

    const container = document.getElementById('talos-mark-tool-root');
    if (container) {
        container.remove();
    }
};
