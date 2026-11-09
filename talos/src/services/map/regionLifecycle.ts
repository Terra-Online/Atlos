import type L from 'leaflet';

const switching = new WeakSet<L.Map>();
export const isRegionSwitching = (map: L.Map) => switching.has(map);
export const setRegionSwitching = (map: L.Map, active: boolean) => {
    if (active) switching.add(map);
    else switching.delete(map);
};

/** Region-owned presentation is cleared before coordinate space changes. */
export function bindRegionLifecycle(map: L.Map, reset: () => void, refresh: () => void) {
    const update = () => { if (!isRegionSwitching(map)) refresh(); };
    map.on('talos:regionSwitchStart', reset);
    map.on('talos:regionSwitched', update);
    update();
    return () => {
        map.off('talos:regionSwitchStart', reset);
        map.off('talos:regionSwitched', update);
        reset();
    };
}
