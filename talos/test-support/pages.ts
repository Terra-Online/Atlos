import L from 'leaflet';

/** A real Leaflet event/zoom surface without tiles, network or the map renderer. */
export function mapFixture(zoom = 1) {
    // jsdom lacks CSS 3D capability detection. Production maps support the
    // fractional zoom steps under test; Leaflet otherwise rounds every step.
    const any3d = L.Browser.any3d;
    Object.defineProperty(L.Browser, 'any3d', { configurable: true, value: true });
    const host = globalThis.document.createElement('div');
    Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    globalThis.document.body.append(host);
    const map = L.map(host, { crs: L.CRS.Simple, zoomControl: false, attributionControl: false,
        minZoom: 0, maxZoom: 3, zoomSnap: 0.5, zoomAnimation: false }).setView([0, 0], zoom);
    return { map, dispose() { map.remove(); host.remove(); Object.defineProperty(L.Browser, 'any3d', { configurable: true, value: any3d }); } };
}

export function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
