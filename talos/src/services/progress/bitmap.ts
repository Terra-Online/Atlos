import { loadAllMarkers } from '@/data/marker';

export const PROGRESS_BITS_PER_POINT = 1;
export const PROGRESS_FORMAT_VERSION = 1;
export const PROGRESS_MARKER_FORMAT = 'bitmap-v1';

export interface ProgressBitmapPayload {
    marker: string;
    checksum: string;
    markerIndexHash: string;
    formatVersion: number;
    bitsPerPoint: number;
    pointCount: number;
}

export interface ProgressManifestPayload {
    markerIndexHash: string;
    pointIds: string[];
}

export interface ProgressMarkerIndex {
    pointIds: string[];
    indexById: Map<string, number>;
    markerIndexHash: string;
}

let markerIndexPromise: Promise<ProgressMarkerIndex> | null = null;

const comparePointIds = (a: string, b: string): number => {
    const numericA = /^\d+$/.test(a);
    const numericB = /^\d+$/.test(b);
    if (numericA && numericB) {
        if (a.length !== b.length) return a.length - b.length;
        return a.localeCompare(b);
    }
    return a.localeCompare(b);
};

export const getProgressManifestPayload = async (): Promise<ProgressManifestPayload> => {
    const markerIndex = await getProgressMarkerIndex();
    return {
        markerIndexHash: markerIndex.markerIndexHash,
        pointIds: markerIndex.pointIds,
    };
};

export const getProgressMarkerIndex = async (): Promise<ProgressMarkerIndex> => {
    markerIndexPromise ??= loadAllMarkers().then(async (markers) => {
        const pointIds = [...new Set(markers.map((marker) => String(marker.id)).filter(Boolean))]
            .sort(comparePointIds);
        return {
            pointIds,
            indexById: new Map(pointIds.map((id, index) => [id, index])),
            markerIndexHash: await sha256Hex(buildCanonicalMarkerManifest(pointIds)),
        };
    });
    return markerIndexPromise;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index] ?? 0);
    }
    return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
    if (!value) return new Uint8Array(0);
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
};

const toHex = (bytes: Uint8Array): string =>
    Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');

const sha256Hex = async (value: string | Uint8Array): Promise<string> => {
    const input = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    const digest = await crypto.subtle.digest('SHA-256', input);
    return toHex(new Uint8Array(digest));
};

const buildCanonicalMarkerManifest = (pointIds: string[]): string => JSON.stringify({
    schemaVersion: 1,
    mapId: 'endfield',
    points: pointIds,
});

export const expectedProgressBitmapBytes = (
    pointCount: number,
    bitsPerPoint = PROGRESS_BITS_PER_POINT,
): number => Math.ceil((pointCount * bitsPerPoint) / 8);

export const normalizeProgressBitmapBytes = (
    marker: string,
    pointCount: number,
    bitsPerPoint = PROGRESS_BITS_PER_POINT,
): Uint8Array => {
    const expectedBytes = expectedProgressBitmapBytes(pointCount, bitsPerPoint);
    const decoded = base64ToBytes(marker);
    if (decoded.length === expectedBytes) return decoded;
    if (decoded.length > expectedBytes) return decoded.slice(0, expectedBytes);

    const padded = new Uint8Array(expectedBytes);
    padded.set(decoded);
    return padded;
};

export const computeProgressChecksum = async (
    bytes: Uint8Array,
    metadata: {
        markerIndexHash: string;
        formatVersion: number;
        bitsPerPoint: number;
        pointCount: number;
    },
): Promise<string> => {
    const prefix = new TextEncoder().encode([
        PROGRESS_MARKER_FORMAT,
        metadata.formatVersion,
        metadata.markerIndexHash,
        metadata.bitsPerPoint,
        metadata.pointCount,
    ].join(':'));
    const input = new Uint8Array(prefix.length + bytes.length);
    input.set(prefix);
    input.set(bytes, prefix.length);
    const digest = await crypto.subtle.digest('SHA-256', input);
    return toHex(new Uint8Array(digest));
};

export const encodeProgressPoints = async (activePoints: string[]): Promise<ProgressBitmapPayload> => {
    const markerIndex = await getProgressMarkerIndex();
    const pointCount = markerIndex.pointIds.length;
    const bytes = new Uint8Array(expectedProgressBitmapBytes(pointCount));

    activePoints.forEach((pointId) => {
        const index = markerIndex.indexById.get(String(pointId));
        if (index === undefined) return;
        const byteIndex = Math.floor(index / 8);
        const bitIndex = index % 8;
        bytes[byteIndex] = (bytes[byteIndex] ?? 0) | (1 << bitIndex);
    });

    return {
        marker: bytesToBase64(bytes),
        checksum: await computeProgressChecksum(bytes, {
            markerIndexHash: markerIndex.markerIndexHash,
            formatVersion: PROGRESS_FORMAT_VERSION,
            bitsPerPoint: PROGRESS_BITS_PER_POINT,
            pointCount,
        }),
        markerIndexHash: markerIndex.markerIndexHash,
        formatVersion: PROGRESS_FORMAT_VERSION,
        bitsPerPoint: PROGRESS_BITS_PER_POINT,
        pointCount,
    };
};

export const decodeProgressPoints = async (
    marker: string,
    pointCount: number,
    bitsPerPoint = PROGRESS_BITS_PER_POINT,
): Promise<string[]> => {
    const markerIndex = await getProgressMarkerIndex();
    const effectivePointCount = Math.min(pointCount, markerIndex.pointIds.length);
    const bytes = normalizeProgressBitmapBytes(marker, effectivePointCount, bitsPerPoint);
    const result: string[] = [];

    for (let index = 0; index < effectivePointCount; index += 1) {
        const byteIndex = Math.floor(index / 8);
        const bitIndex = index % 8;
        if (((bytes[byteIndex] ?? 0) & (1 << bitIndex)) !== 0) {
            const pointId = markerIndex.pointIds[index];
            if (pointId) result.push(pointId);
        }
    }

    return result;
};

export const decodeProgressStatsCounts = (counts: string, pointCount: number): Uint32Array => {
    const bytes = normalizeStatsBytes(base64ToBytes(counts), pointCount * Uint32Array.BYTES_PER_ELEMENT);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return new Uint32Array(buffer);
};

const normalizeStatsBytes = (bytes: Uint8Array, expectedBytes: number): Uint8Array => {
    if (bytes.length === expectedBytes) return bytes;
    if (bytes.length > expectedBytes) return bytes.slice(0, expectedBytes);
    const padded = new Uint8Array(expectedBytes);
    padded.set(bytes);
    return padded;
};
