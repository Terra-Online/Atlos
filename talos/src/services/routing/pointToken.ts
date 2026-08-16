const BASE62_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BASE62_CHAR_TO_VALUE = new Map<string, bigint>(
    BASE62_ALPHABET.split('').map((char, index) => [char, BigInt(index)]),
);
const BASE62_BASE = BigInt(BASE62_ALPHABET.length);
const POINT_ID_PERMUTATION_MOD = 1n << 36n;
const POINT_ID_PERMUTATION_MULTIPLIER = 25214903917n;
const POINT_ID_PERMUTATION_OFFSET = 11n;
const POINT_ID_TOKEN_LENGTH = 7;

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
