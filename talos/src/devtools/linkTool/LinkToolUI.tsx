import React, { useState, useCallback, useEffect, useRef } from 'react';
import L from 'leaflet';
import { useLinkStore, selectGlobalConfig } from '@/store/link';
import { mapRegionKeyToLinkCode, roundBounds } from '@/data/map/link';
import type { MapLink, LinkTarget, LinkBounds, GlobalLinkConfig } from '@/data/map/link';
import { REGION_DICT } from '@/data/map';
import useRegion from '@/store/region';

interface LinkToolUIProps {
    map: L.Map;
}

type DrawMode = 'idle' | 'drawing';

// Generate simple link ID: "VL/link_0", "VL/link_1", etc.
const generateLinkId = (region: string, existingLinks: Record<string, MapLink>): string => {
    const existingIds = Object.keys(existingLinks);
    let index = 0;
    while (existingIds.includes(`${region}/link_${index}`)) {
        index++;
    }
    return `${region}/link_${index}`;
};

export const LinkToolUI: React.FC<LinkToolUIProps> = ({ map }) => {
    const [mode, setMode] = useState<DrawMode>('idle');
    const [selectedLink, setSelectedLink] = useState<MapLink | null>(null);
    const [configForm, setConfigForm] = useState<GlobalLinkConfig>({
        leftLink: { titleKey: '', url: '' },
        rightLink: { titleKey: '', url: '' },
    });

    const drawRectRef = useRef<L.Rectangle | null>(null);
    const startPointRef = useRef<L.LatLng | null>(null);

    const { current: linkData, upsertLink, removeLink, updateConfig } = useLinkStore();
    const globalConfig = useLinkStore(selectGlobalConfig);

    // Sync form with global config
    useEffect(() => {
        if (globalConfig) {
            setConfigForm({
                leftLink: { ...globalConfig.leftLink },
                rightLink: { ...globalConfig.rightLink },
            });
        }
    }, [globalConfig]);

    // Get current region from store
    const currentRegionKey = useRegion((s) => s.currentRegionKey);
    const currentRegion = mapRegionKeyToLinkCode(currentRegionKey);

    // Get maxZoom for current region
    const getMaxZoom = useCallback((): number => {
        return currentRegionKey ? REGION_DICT[currentRegionKey]?.maxZoom ?? 3 : 3;
    }, [currentRegionKey]);

    // Handle drawing mode
    const startDrawing = useCallback(() => {
        setMode('drawing');
        map.getContainer().style.cursor = 'crosshair';
    }, [map]);

    const cancelDrawing = useCallback(() => {
        setMode('idle');
        map.getContainer().style.cursor = '';
        if (drawRectRef.current) {
            map.removeLayer(drawRectRef.current);
            drawRectRef.current = null;
        }
        startPointRef.current = null;
    }, [map]);

    // Mouse event handlers for drawing (square 1:1)
    useEffect(() => {
        if (mode !== 'drawing') return;

        const onMouseDown = (e: L.LeafletMouseEvent) => {
            startPointRef.current = e.latlng;
            drawRectRef.current = L.rectangle(
                L.latLngBounds(e.latlng, e.latlng),
                { color: '#2196F3', weight: 2, fillOpacity: 0.3 }
            ).addTo(map);
        };

        const onMouseMove = (e: L.LeafletMouseEvent) => {
            if (!startPointRef.current || !drawRectRef.current) return;
            
            // Calculate square bounds (1:1 aspect ratio)
            const start = startPointRef.current;
            const current = e.latlng;
            
            // Use the larger dimension to create a square
            const latDiff = Math.abs(current.lat - start.lat);
            const lngDiff = Math.abs(current.lng - start.lng);
            const size = Math.max(latDiff, lngDiff);
            
            // Determine direction
            const latDir = current.lat >= start.lat ? 1 : -1;
            const lngDir = current.lng >= start.lng ? 1 : -1;
            
            const corner = L.latLng(start.lat + size * latDir, start.lng + size * lngDir);
            drawRectRef.current.setBounds(L.latLngBounds(start, corner));
        };

        const onMouseUp = () => {
            if (!startPointRef.current || !drawRectRef.current || !currentRegion) {
                cancelDrawing();
                return;
            }

            const bounds = drawRectRef.current.getBounds();
            const maxZoom = getMaxZoom();

            // Convert to pixel coordinates
            const sw = map.project(bounds.getSouthWest(), maxZoom);
            const ne = map.project(bounds.getNorthEast(), maxZoom);

            // Make it a perfect square in pixel space and round to 3 decimal places
            const width = Math.abs(ne.x - sw.x);
            const height = Math.abs(ne.y - sw.y);
            const size = Math.max(width, height);

            const rawBounds: [[number, number], [number, number]] = [
                [Math.min(sw.x, ne.x), Math.min(sw.y, ne.y)],
                [Math.min(sw.x, ne.x) + size, Math.min(sw.y, ne.y) + size],
            ];
            const pixelBounds: LinkBounds = roundBounds(rawBounds);

            // Create new link (simple structure, no leftLink/rightLink per area)
            const existingLinks = linkData.regions[currentRegion]?.links ?? {};
            const newLink: MapLink = {
                id: generateLinkId(currentRegion, existingLinks),
                region: currentRegion,
                bounds: pixelBounds,
            };

            upsertLink(newLink);
            setSelectedLink(newLink);

            // Clean up drawing state
            map.removeLayer(drawRectRef.current);
            drawRectRef.current = null;
            startPointRef.current = null;
            setMode('idle');
            map.getContainer().style.cursor = '';
        };

        map.on('mousedown', onMouseDown);
        map.on('mousemove', onMouseMove);
        map.on('mouseup', onMouseUp);

        return () => {
            map.off('mousedown', onMouseDown);
            map.off('mousemove', onMouseMove);
            map.off('mouseup', onMouseUp);
        };
    }, [mode, map, currentRegion, linkData, upsertLink, getMaxZoom, cancelDrawing]);

    // Get links for current region
    const links = currentRegion ? Object.values(linkData.regions[currentRegion]?.links ?? {}) : [];

    // Select a link for editing
    const selectLink = (link: MapLink) => {
        setSelectedLink(link);
    };

    // Update global config form
    const updateConfigForm = (side: 'leftLink' | 'rightLink', field: keyof LinkTarget, value: string) => {
        setConfigForm(prev => ({
            ...prev,
            [side]: { ...prev[side], [field]: value },
        }));
    };

    // Save global config
    const saveConfig = () => {
        updateConfig(configForm);
    };

    // Delete link
    const deleteSelectedLink = () => {
        if (!selectedLink || !currentRegion) return;
        removeLink(currentRegion, selectedLink.id);
        setSelectedLink(null);
    };

    // Export JSON
    const exportJson = () => {
        const json = JSON.stringify(linkData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'links.json';
        a.click();
        URL.revokeObjectURL(url);
    };

    // Copy JSON to clipboard
    const copyJson = () => {
        const json = JSON.stringify(linkData, null, 2);
        void navigator.clipboard.writeText(json);
    };

    return (
        <div style={uiStyles.container}>
            <div style={uiStyles.header}>
                <h3 style={uiStyles.title}>🔗 Link Tool</h3>
                <span style={uiStyles.region}>Region: {currentRegion ?? 'N/A'}</span>
            </div>

            {/* Global Config Section */}
            <div style={uiStyles.configSection}>
                <h4 style={uiStyles.subtitle}>⚙️ Global Link Config</h4>
                <p style={uiStyles.hint}>These links apply to ALL link areas</p>
                
                <div style={uiStyles.tooltipSection}>
                    <label style={uiStyles.sectionLabel}>⬅️ Left Tooltip</label>
                    <input
                        style={uiStyles.input}
                        value={configForm.leftLink.titleKey}
                        onChange={(e) => updateConfigForm('leftLink', 'titleKey', e.target.value)}
                        placeholder="Title (i18n key)"
                    />
                    <input
                        style={uiStyles.input}
                        value={configForm.leftLink.url}
                        onChange={(e) => updateConfigForm('leftLink', 'url', e.target.value)}
                        placeholder="URL (https://...)"
                    />
                </div>

                <div style={uiStyles.tooltipSection}>
                    <label style={uiStyles.sectionLabel}>➡️ Right Tooltip</label>
                    <input
                        style={uiStyles.input}
                        value={configForm.rightLink.titleKey}
                        onChange={(e) => updateConfigForm('rightLink', 'titleKey', e.target.value)}
                        placeholder="Title (i18n key)"
                    />
                    <input
                        style={uiStyles.input}
                        value={configForm.rightLink.url}
                        onChange={(e) => updateConfigForm('rightLink', 'url', e.target.value)}
                        placeholder="URL (https://...)"
                    />
                </div>

                <button style={{ ...uiStyles.button, ...uiStyles.saveButton }} onClick={saveConfig}>
                    💾 Save Config
                </button>
            </div>

            <div style={uiStyles.toolbar}>
                {mode === 'idle' ? (
                    <button style={uiStyles.button} onClick={startDrawing}>
                        ⬛ Draw Square
                    </button>
                ) : (
                    <button style={{ ...uiStyles.button, ...uiStyles.cancelButton }} onClick={cancelDrawing}>
                        ❌ Cancel
                    </button>
                )}
                <button style={uiStyles.button} onClick={exportJson}>📥 Export</button>
                <button style={uiStyles.button} onClick={copyJson}>📋 Copy</button>
            </div>

            <div style={uiStyles.linkList}>
                <h4 style={uiStyles.subtitle}>Link Areas ({links.length})</h4>
                {links.map((link) => (
                    <div
                        key={link.id}
                        style={{
                            ...uiStyles.linkItem,
                            ...(selectedLink?.id === link.id ? uiStyles.linkItemSelected : {}),
                        }}
                        onClick={() => selectLink(link)}
                    >
                        <span style={uiStyles.linkId}>{link.id}</span>
                        <span style={uiStyles.linkBounds}>
                            [{link.bounds[0][0].toFixed(0)}, {link.bounds[0][1].toFixed(0)}]
                        </span>
                    </div>
                ))}
            </div>

            {selectedLink && (
                <div style={uiStyles.editor}>
                    <h4 style={uiStyles.subtitle}>Selected: {selectedLink.id}</h4>
                    <p style={uiStyles.hint}>
                        Bounds: [[{selectedLink.bounds[0].join(', ')}], [{selectedLink.bounds[1].join(', ')}]]
                    </p>
                    <div style={uiStyles.editorActions}>
                        <button style={{ ...uiStyles.button, ...uiStyles.deleteButton }} onClick={deleteSelectedLink}>
                            🗑️ Delete
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

const uiStyles: Record<string, React.CSSProperties> = {
    container: {
        background: 'rgba(30, 30, 30, 0.95)',
        borderRadius: '8px',
        padding: '16px',
        width: '340px',
        maxHeight: '85vh',
        overflowY: 'auto',
        color: '#fff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px',
        borderBottom: '1px solid #444',
        paddingBottom: '8px',
    },
    title: {
        margin: 0,
        fontSize: '16px',
    },
    region: {
        fontSize: '11px',
        color: '#888',
    },
    configSection: {
        marginBottom: '16px',
        padding: '12px',
        background: '#252525',
        borderRadius: '6px',
        border: '1px solid #444',
    },
    toolbar: {
        display: 'flex',
        gap: '8px',
        marginBottom: '12px',
    },
    button: {
        padding: '6px 10px',
        border: 'none',
        borderRadius: '4px',
        background: '#444',
        color: '#fff',
        cursor: 'pointer',
        fontSize: '12px',
    },
    cancelButton: {
        background: '#c62828',
    },
    saveButton: {
        background: '#2e7d32',
        width: '100%',
        marginTop: '8px',
    },
    deleteButton: {
        background: '#c62828',
    },
    linkList: {
        marginBottom: '12px',
    },
    subtitle: {
        margin: '0 0 8px 0',
        fontSize: '13px',
        color: '#aaa',
    },
    hint: {
        margin: '0 0 8px 0',
        fontSize: '11px',
        color: '#666',
    },
    linkItem: {
        display: 'flex',
        justifyContent: 'space-between',
        padding: '8px',
        background: '#333',
        borderRadius: '4px',
        marginBottom: '4px',
        cursor: 'pointer',
    },
    linkItemSelected: {
        background: '#1565c0',
    },
    linkId: {
        fontFamily: 'monospace',
        fontSize: '11px',
    },
    linkBounds: {
        fontSize: '10px',
        color: '#888',
        fontFamily: 'monospace',
    },
    editor: {
        borderTop: '1px solid #444',
        paddingTop: '12px',
    },
    tooltipSection: {
        marginBottom: '12px',
        padding: '8px',
        background: '#2a2a2a',
        borderRadius: '4px',
    },
    sectionLabel: {
        display: 'block',
        marginBottom: '8px',
        color: '#fff',
        fontSize: '12px',
        fontWeight: 'bold',
    },
    input: {
        width: '100%',
        padding: '6px 8px',
        marginBottom: '6px',
        border: '1px solid #555',
        borderRadius: '4px',
        background: '#222',
        color: '#fff',
        fontSize: '12px',
        boxSizing: 'border-box',
    },
    editorActions: {
        display: 'flex',
        gap: '8px',
        marginTop: '8px',
    },
};
