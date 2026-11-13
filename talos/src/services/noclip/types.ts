// JSON contract v1; the producer and canonical contract live in endfield-noclip/package-format/oem.
export const VERSION = 1;
export interface CameraView {
    groundY: number;
    fovY: number;
    aspect: number;
}
export const isCameraView = (v: unknown): v is CameraView =>
    record(v) &&
    typeof v.groundY === 'number' &&
    Number.isFinite(v.groundY) &&
    typeof v.fovY === 'number' &&
    Number.isFinite(v.fovY) &&
    v.fovY > 0 &&
    v.fovY < Math.PI &&
    typeof v.aspect === 'number' &&
    Number.isFinite(v.aspect) &&
    v.aspect > 0;
/** Location-only camera target; legacy messages may contain additional companion fields. */
export interface Point {
    id: string;
    scene: string;
    level: string;
    region: string;
    subregion: string;
    tier: number;
    position: [number, number, number];
}
export interface CameraSample {
    point: Point;
    position: [number, number, number];
    forward: [number, number, number];
    view?: CameraView;
}
export interface Catalog {
    format: 'oem-noclip';
    version: number;
    release: string;
    files: Record<string, string>;
    pointIndex: Record<string, string>;
}
export const record = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v);
export const vector = (v: unknown): v is [number, number, number] =>
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n));
export const isPoint = (v: unknown): v is Point =>
    record(v) &&
    typeof v.id === 'string' &&
    typeof v.scene === 'string' &&
    typeof v.level === 'string' &&
    typeof v.region === 'string' &&
    typeof v.subregion === 'string' &&
    Number.isInteger(v.tier) &&
    vector(v.position);
export const isCameraSample = (v: unknown): v is CameraSample =>
    record(v) &&
    isPoint(v.point) &&
    vector(v.position) &&
    vector(v.forward) &&
    (v.view === undefined || isCameraView(v.view));
export const isPreviewOrigin = (origin: string): boolean => {
    try {
        const url = new URL(origin);
        return (
            url.origin === origin &&
            ((url.protocol === 'https:' &&
                ['world.opendfieldmap.org', 'world.oem.re', 'oem-world.pages.dev'].includes(url.hostname)) ||
                (url.protocol === 'http:' &&
                    ['127.0.0.1', 'localhost'].includes(url.hostname)))
        );
    } catch {
        return false;
    }
};

const dictionary = (value: unknown): value is Record<string, string> =>
    record(value) && Object.values(value).every((v) => typeof v === 'string');
export const isCatalog = (v: unknown): v is Catalog =>
    record(v) &&
    v.format === 'oem-noclip' &&
    v.version === VERSION &&
    typeof v.release === 'string' &&
    dictionary(v.pointIndex) &&
    dictionary(v.files) &&
    Object.values(v.files).every(
        (path) => /^[A-Za-z0-9_/-]+\.json$/.test(path) && !path.startsWith('/'),
    );

/** Exact main-site origins allowed to control a World window. */
export const isMapOrigin = (origin: string): boolean => {
    try {
        const url = new URL(origin);
        return url.origin === origin && (
            (url.protocol === 'https:' && ['opendfieldmap.org', 'opendfieldmap.cn', 'oem.re', 'www.opendfieldmap.org', 'www.opendfieldmap.cn', 'beta.opendfieldmap.org', 'beta.opendfieldmap.cn'].includes(url.hostname)) ||
            (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
        );
    } catch { return false; }
};
