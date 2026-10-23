import { bindRegionLifecycle, isRegionSwitching } from '@/services/map/regionLifecycle';
import { useEffect, useState } from 'react';
import type L from 'leaflet';
import { loadMapSupplements } from '@/data/marker/supplements';
import { getLayerTier, useCurrentLayer } from '@/store/layer';
import { useMarkerStore } from '@/store/marker';
import useRegion from '@/store/region';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { createBehaviorCanvasLayer } from '@/pages/map/behaviorOverlay/BehaviorCanvasLayer';
import { emptyBehaviorScene, wallScene } from '@/pages/map/behaviorOverlay/behaviorScene';

/** Static map geometry has its own lifetime, independent of marker selection. */
export function useMapSupplements(map: L.Map | null) {
    const [hover, setHover] = useState<{ left: number; top: number } | null>(null);
    const enabled = useUiPrefsStore((state) => state.mapSupplementsEnabled);
    const region = useRegion((state) => state.currentRegionKey);
    const subregion = useMarkerStore((state) => state.visibleSubregionKey);
    const tier = getLayerTier(useCurrentLayer());

    useEffect(() => {
        if (!map || !enabled) return;
        const layer = createBehaviorCanvasLayer((point) => {
            const rect = map.getContainer().getBoundingClientRect();
            setHover(point ? { left: rect.left + point.x, top: rect.top + point.y } : null);
        });
        let disposed = false;
        let request = 0;
        const render = () => {
            if (isRegionSwitching(map)) return;
            const generation = ++request;
            if (!map.hasLayer(layer)) layer.addTo(map);
            layer.setScene(emptyBehaviorScene(), false, false);
            void loadMapSupplements(region).then((walls) => {
                if (disposed || generation !== request || useRegion.getState().currentRegionKey !== region) return;
                layer.setScene(wallScene(walls.filter((wall) =>
                    !subregion || wall.subregion === subregion,
                ).map((wall) => ({ ...wall, opacity: wall.tier === tier ? 0.85 : 0.25 }))), false, false);
            }).catch(() => {
                if (!disposed && generation === request) layer.setScene(emptyBehaviorScene(), false, false);
            });
        };
        const unbind = bindRegionLifecycle(map, () => { request++; setHover(null); layer.setScene(emptyBehaviorScene(), false, false); }, render);
        return () => {
            disposed = true;
            setHover(null);
            unbind();
            layer.remove();
        };
    }, [map, enabled, region, subregion, tier]);
    return hover;
}
