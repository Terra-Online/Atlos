import type L from 'leaflet';

const panes = {
    links: { name: 'links', z: 450, pointerEvents: 'auto' },
    behavior: { name: 'behaviorOverlay', z: 470, pointerEvents: 'none' },
    locator: { name: 'talos-endfield-tracker-pane', z: 640, pointerEvents: 'none' },
    labels: { name: 'labels', z: 650, pointerEvents: 'none' },
} as const;

export function ensureMapPane(map: L.Map, kind: keyof typeof panes): string {
    const { name, z, pointerEvents } = panes[kind];
    const pane = map.getPane(name) ?? map.createPane(name);
    pane.style.zIndex = String(z);
    pane.style.pointerEvents = pointerEvents;
    return name;
}
