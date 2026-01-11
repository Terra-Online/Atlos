import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LayerType = 'M' | 'B1' | 'B2' | 'B3' | 'B4' | 'L1' | 'L2' | 'L3';

interface LayerState {
    currentLayer: LayerType;
    setCurrentLayer: (layer: LayerType) => void;
}

export const useLayerStore = create<LayerState>()(
    persist(
        (set) => ({
            currentLayer: 'M',
            setCurrentLayer: (layer) => set({ currentLayer: layer }),
        }),
        {
            name: 'atlos-layer-storage',
        }
    )
);

export const useCurrentLayer = () => useLayerStore((state) => state.currentLayer);
export const useSetCurrentLayer = () => useLayerStore((state) => state.setCurrentLayer);

// Helper to convert layer type to tile suffix
export const getLayerTileSuffix = (layer: LayerType): string => {
    if (layer === 'M') return '';
    return `_${layer.toLowerCase()}`;
};
