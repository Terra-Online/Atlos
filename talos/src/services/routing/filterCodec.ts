import { MARKER_TYPE_DICT } from '@/data/marker';

const FILTER_SINGLE_PREFIX = '~';
const FILTER_MULTI_PREFIX = '~~';

const SORTED_MARKER_TYPE_KEYS = Object.keys(MARKER_TYPE_DICT).sort();
const MARKER_TYPE_INDEX_MAP = new Map<string, number>(
    SORTED_MARKER_TYPE_KEYS.map((key, index) => [key, index]),
);

const hashTypeKey = (key: string): number => {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = ((hash << 5) - hash) + key.charCodeAt(i);
        hash &= hash;
    }
    return Math.abs(hash) % 65536;
};

const encodeVarUint = (num: number): number[] => {
    const bytes: number[] = [];
    let value = num >>> 0;
    while (value >= 0x80) {
        bytes.push((value & 0x7f) | 0x80);
        value >>>= 7;
    }
    bytes.push(value);
    return bytes;
};

const decodeVarUint = (
    bytes: Uint8Array,
    startOffset: number,
): { value: number; nextOffset: number } | null => {
    let value = 0;
    let shift = 0;
    let offset = startOffset;

    while (offset < bytes.length && shift < 35) {
        const byte = bytes[offset++];
        value |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) {
            return { value, nextOffset: offset };
        }
        shift += 7;
    }

    return null;
};

const toBase64Url = (bytes: Uint8Array): string => {
    let binary = '';
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
};

const fromBase64Url = (encoded: string): Uint8Array | null => {
    try {
        const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
        const binary = atob(padded);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    } catch {
        return null;
    }
};

const compressFilter = (keys: string[]): string => {
    if (keys.length === 0) return '';

    const indexes = Array.from(
        new Set(
            keys
                .map((key) => MARKER_TYPE_INDEX_MAP.get(key))
                .filter((idx): idx is number => idx !== undefined),
        ),
    ).sort((a, b) => a - b);

    if (indexes.length === 0) return '';
    if (indexes.length === 1) return `${FILTER_SINGLE_PREFIX}${indexes[0].toString(36)}`;

    const bytes: number[] = [];
    bytes.push(...encodeVarUint(indexes.length));
    bytes.push(...encodeVarUint(indexes[0]));
    for (let i = 1; i < indexes.length; i++) {
        bytes.push(...encodeVarUint(indexes[i] - indexes[i - 1] - 1));
    }

    return `${FILTER_MULTI_PREFIX}${toBase64Url(new Uint8Array(bytes))}`;
};

const decompressFilterV2 = (encoded: string): string[] => {
    if (encoded.startsWith(FILTER_SINGLE_PREFIX) && !encoded.startsWith(FILTER_MULTI_PREFIX)) {
        const index = Number.parseInt(encoded.slice(FILTER_SINGLE_PREFIX.length), 36);
        if (!Number.isInteger(index) || index < 0 || index >= SORTED_MARKER_TYPE_KEYS.length) return [];
        const key = SORTED_MARKER_TYPE_KEYS[index];
        return key ? [key] : [];
    }

    if (!encoded.startsWith(FILTER_MULTI_PREFIX)) return [];

    const bytes = fromBase64Url(encoded.slice(FILTER_MULTI_PREFIX.length));
    if (!bytes || bytes.length === 0) return [];

    let offset = 0;
    const countDecoded = decodeVarUint(bytes, offset);
    if (!countDecoded || countDecoded.value <= 1) return [];
    const count = countDecoded.value;
    offset = countDecoded.nextOffset;

    const firstDecoded = decodeVarUint(bytes, offset);
    if (!firstDecoded) return [];
    let currentIndex = firstDecoded.value;
    offset = firstDecoded.nextOffset;
    if (currentIndex < 0 || currentIndex >= SORTED_MARKER_TYPE_KEYS.length) return [];

    const indexes: number[] = [currentIndex];
    for (let i = 1; i < count; i++) {
        const deltaDecoded = decodeVarUint(bytes, offset);
        if (!deltaDecoded) return [];
        offset = deltaDecoded.nextOffset;
        currentIndex += deltaDecoded.value + 1;
        if (currentIndex < 0 || currentIndex >= SORTED_MARKER_TYPE_KEYS.length) return [];
        indexes.push(currentIndex);
    }

    if (offset !== bytes.length) return [];
    return indexes.map((index) => SORTED_MARKER_TYPE_KEYS[index]).filter(Boolean);
};

const bitsToNumber = (bits: number[]): number => {
    let num = 0;
    for (let i = 0; i < bits.length; i++) {
        if (bits[i]) num |= (1 << i);
    }
    return num;
};

const decompressLegacyFilter = (encoded: string): string[] => {
    try {
        const bytes = fromBase64Url(encoded);
        if (!bytes) return [];

        const bits: number[] = [];
        for (let i = 0; i < bytes.length; i++) {
            const byte = bytes[i];
            for (let j = 0; j < 8; j++) bits.push((byte >> j) & 1);
        }

        const hashToKey = new Map<number, string>();
        Object.keys(MARKER_TYPE_DICT).forEach((key) => {
            hashToKey.set(hashTypeKey(key), key);
        });

        const positions: number[] = [];
        let bitIndex = 0;
        if (bits.length < 11) return [];
        positions.push(bitsToNumber(bits.slice(0, 11)));
        bitIndex = 11;

        while (bitIndex + 4 <= bits.length) {
            const bitLength = bitsToNumber(bits.slice(bitIndex, bitIndex + 4));
            bitIndex += 4;
            if (bitLength === 0 || bitIndex + bitLength > bits.length) break;
            const delta = bitsToNumber(bits.slice(bitIndex, bitIndex + bitLength));
            bitIndex += bitLength;
            positions.push(positions[positions.length - 1] + delta);
        }

        return positions
            .map((position) => hashToKey.get(position))
            .filter((key): key is string => key !== undefined);
    } catch {
        return [];
    }
};

export const decompressFilter = (encoded: string): string[] => {
    const v2 = decompressFilterV2(encoded);
    return v2.length > 0 ? v2 : decompressLegacyFilter(encoded);
};

export const getFilterParamValue = (keys: string[]): string => {
    if (keys.length === 0) return '';
    const validKeys = keys.filter((key) => MARKER_TYPE_DICT[key]);
    return validKeys.length > 0 ? compressFilter(validKeys) : '';
};
