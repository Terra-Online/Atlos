import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { LAYER_ORDER } from '@/data/map/tiles';

export type LayerType = (typeof LAYER_ORDER)[number];

interface LayerState {
    currentLayer: LayerType;
    setCurrentLayer: (layer: LayerType) => void;
    satellite: boolean;
    setSatellite: (enabled: boolean) => void;
}

export const useLayerStore = create<LayerState>()(
    persist(
        (set) => ({
            currentLayer: 'M',
            setCurrentLayer: (layer) => set({ currentLayer: layer }),
            satellite: false,
            setSatellite: (satellite) => set(satellite ? { satellite, currentLayer: 'M' } : { satellite }),
        }),
        {
            name: 'atlos-layer-storage',
        }
    )
);

export const useCurrentLayer = () => useLayerStore((state) => state.currentLayer);
export const useSetCurrentLayer = () => useLayerStore((state) => state.setCurrentLayer);

export const getLayerTier = (layer: LayerType): number => {
    if (layer === 'M') return 0;
    const tier = Number(layer.slice(1));
    return layer.startsWith('B') ? -tier : tier;
};

export const getLayerByTier = (tier: number): LayerType | null => {
    const normalizedTier = Math.trunc(tier);
    const layer = normalizedTier === 0
        ? 'M'
        : `${normalizedTier < 0 ? 'B' : 'L'}${Math.abs(normalizedTier)}`;
    return LAYER_ORDER.includes(layer as LayerType) ? layer as LayerType : null;
};

// Helper to convert layer type to tile suffix
export const getLayerTileSuffix = (layer: LayerType): string => {
    if (layer === 'M') return '';
    return `_${layer.toLowerCase()}`;
};
