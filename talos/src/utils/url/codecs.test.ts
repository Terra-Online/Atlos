import { describe, expect, it } from 'vitest';
import { MARKER_TYPE_DICT } from '@/data/marker';
import {
    decodePointIdToken,
    decompressFilter,
    encodePointIdToken,
    getFilterParamValue,
} from './codecs';

describe('point share token codec', () => {
    it('round-trips supported numeric point IDs', () => {
        for (const pointId of ['0', '1', '123456789', '68719476735']) {
            const token = encodePointIdToken(pointId);
            expect(token).toMatch(/^[0-9a-zA-Z]{7}$/);
            if (!token) throw new Error(`Expected token for point ID ${pointId}`);
            expect(decodePointIdToken(token)).toBe(pointId);
        }
    });

    it('rejects IDs and tokens outside the protocol shape', () => {
        expect(encodePointIdToken('-1')).toBeNull();
        expect(encodePointIdToken('68719476736')).toBeNull();
        expect(decodePointIdToken('short')).toBeNull();
        expect(decodePointIdToken('!!!!!!!')).toBeNull();
    });
});

describe('filter codec', () => {
    it('round-trips single and multi-type filters', () => {
        const keys = Object.keys(MARKER_TYPE_DICT).slice(0, 3);
        expect(keys.length).toBe(3);

        const single = getFilterParamValue([keys[0]]);
        const multiple = getFilterParamValue([keys[2], keys[0], keys[1], keys[0]]);

        expect(decompressFilter(single)).toEqual([keys[0]]);
        expect(decompressFilter(multiple)).toEqual([...keys].sort());
    });

    it('returns no keys for malformed payloads', () => {
        expect(decompressFilter('~~not-valid-base64')).toEqual([]);
        expect(decompressFilter('~not-a-type-index')).toEqual([]);
    });
});
