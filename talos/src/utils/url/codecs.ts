import { MARKER_TYPE_DICT } from '@/data/marker';

const BASE62_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BASE62_CHAR_TO_VALUE = new Map<string, bigint>(
    BASE62_ALPHABET.split('').map((char, index) => [char, BigInt(index)]),
);
const BASE62_BASE = BigInt(BASE62_ALPHABET.length);
const POINT_ID_PERMUTATION_MOD = 1n << 36n;
const POINT_ID_PERMUTATION_MULTIPLIER = 25214903917n;
const POINT_ID_PERMUTATION_OFFSET = 11n;
const POINT_ID_TOKEN_LENGTH = 7;
const FILTER_SINGLE_PREFIX = '~';
const FILTER_MULTI_PREFIX = '~~';

const SORTED_MARKER_TYPE_KEYS = Object.keys(MARKER_TYPE_DICT).sort();
const MARKER_TYPE_INDEX_MAP = new Map<string, number>(
    SORTED_MARKER_TYPE_KEYS.map((key, index) => [key, index]),
);

const modInverse = (a: bigint, mod: bigint): bigint => {
    let t = 0n;
    let newT = 1n;
    let r = mod;
    let newR = ((a % mod) + mod) % mod;

    while (newR !== 0n) {
        const quotient = r / newR;
        [t, newT] = [newT, t - quotient * newT];
        [r, newR] = [newR, r - quotient * newR];
    }

    if (r !== 1n) {
        throw new Error('Permutation multiplier is not invertible under modulus');
    }

    return ((t % mod) + mod) % mod;
};

const POINT_ID_PERMUTATION_INVERSE = modInverse(
    POINT_ID_PERMUTATION_MULTIPLIER,
    POINT_ID_PERMUTATION_MOD,
);

const encodeBase62 = (value: bigint): string => {
    if (value === 0n) return '0';

    let num = value;
    let encoded = '';
    while (num > 0n) {
        const remainder = Number(num % BASE62_BASE);
        encoded = BASE62_ALPHABET[remainder] + encoded;
        num /= BASE62_BASE;
    }
    return encoded;
};

const decodeBase62 = (encoded: string, maxLength: number = Number.POSITIVE_INFINITY): bigint | null => {
    if (!encoded || encoded.length > maxLength) return null;

    let value = 0n;
    for (const char of encoded) {
        const digit = BASE62_CHAR_TO_VALUE.get(char);
        if (digit === undefined) return null;
        value = value * BASE62_BASE + digit;
    }
    return value;
};

export const encodePointIdToken = (pointId: string): string | null => {
    if (!/^\d+$/.test(pointId)) return null;

    const id = BigInt(pointId);
    if (id < 0n || id >= POINT_ID_PERMUTATION_MOD) return null;

    const obfuscated = (
        id * POINT_ID_PERMUTATION_MULTIPLIER + POINT_ID_PERMUTATION_OFFSET
    ) % POINT_ID_PERMUTATION_MOD;
    return encodeBase62(obfuscated).padStart(POINT_ID_TOKEN_LENGTH, '0');
};

export const decodePointIdToken = (token: string): string | null => {
    if (token.length !== POINT_ID_TOKEN_LENGTH) return null;

    const encoded = token.replace(/^0+/, '') || '0';
    const obfuscated = decodeBase62(encoded, POINT_ID_TOKEN_LENGTH);
    if (obfuscated === null || obfuscated < 0n || obfuscated >= POINT_ID_PERMUTATION_MOD) {
        return null;
    }

    const decoded = (
        obfuscated - POINT_ID_PERMUTATION_OFFSET + POINT_ID_PERMUTATION_MOD
    ) % POINT_ID_PERMUTATION_MOD;
    const id = (decoded * POINT_ID_PERMUTATION_INVERSE) % POINT_ID_PERMUTATION_MOD;
    return id.toString();
};

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
    if (indexes.length === 1) {
        return `${FILTER_SINGLE_PREFIX}${indexes[0].toString(36)}`;
    }

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
        if (!Number.isInteger(index) || index < 0 || index >= SORTED_MARKER_TYPE_KEYS.length) {
            return [];
        }
        const key = SORTED_MARKER_TYPE_KEYS[index];
        return key ? [key] : [];
    }

    if (!encoded.startsWith(FILTER_MULTI_PREFIX)) return [];

    const bytes = fromBase64Url(encoded.slice(FILTER_MULTI_PREFIX.length));
    if (!bytes || bytes.length === 0) return [];

    let offset = 0;
    const countDecoded = decodeVarUint(bytes, offset);
    if (!countDecoded) return [];
    const count = countDecoded.value;
    offset = countDecoded.nextOffset;
    if (count <= 1) return [];

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
