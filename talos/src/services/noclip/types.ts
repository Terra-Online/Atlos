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
export interface Preset {
    id: string;
    label: string;
    satisfies: boolean;
}
export interface Point {
    id: string;
    scene: string;
    level: string;
    region: string;
    subregion: string;
    tier: number;
    position: [number, number, number];
    condition: { alternatives: { control: string; mask: number }[][] } | null;
    locks: { kind: string; quests: string[]; games: string[] }[];
    unknown: string[];
    presets: Preset[];
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
    vector(v.position) &&
    Array.isArray(v.presets) &&
    v.presets.every(
        (p) =>
            record(p) &&
            typeof p.id === 'string' &&
            typeof p.label === 'string' &&
            typeof p.satisfies === 'boolean',
    ) &&
    Array.isArray(v.unknown) &&
    v.unknown.every((u) => typeof u === 'string') &&
    Array.isArray(v.locks) &&
    v.locks.every(
        (l) =>
            record(l) &&
            typeof l.kind === 'string' &&
            Array.isArray(l.quests) &&
            Array.isArray(l.games),
    ) &&
    (v.condition === null ||
        (record(v.condition) &&
            Array.isArray(v.condition.alternatives) &&
            v.condition.alternatives.every(
                (a) =>
                    Array.isArray(a) &&
                    a.every(
                        (r) =>
                            record(r) &&
                            typeof r.control === 'string' &&
                            Number.isInteger(r.mask),
                    ),
            )));
export const isPreviewOrigin = (origin: string): boolean => {
    try {
        const url = new URL(origin);
        return (
            url.origin === origin &&
            ((url.protocol === 'https:' &&
                url.hostname === 'oem-noclip.pages.dev') ||
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
