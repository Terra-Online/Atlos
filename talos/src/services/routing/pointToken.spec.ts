import { describe, expect, it } from 'vitest';
import { decodePointIdToken, encodePointIdToken } from './pointToken';

describe('published point tokens', () => {
    it.each([
        ['0', '000000b'],
        ['1', '0rwramQ'],
        ['123456789', '08OVvd2'],
        ['68719476735', '0LucKKy'],
    ])('preserves the token for %s', (id, token) => {
        expect(encodePointIdToken(id)).toBe(token);
        expect(decodePointIdToken(token)).toBe(id);
    });

    it.each(['-1', '68719476736', '1.5', '', 'abc', ' 1'])('rejects invalid ID %s', (id) => {
        expect(encodePointIdToken(id)).toBeNull();
    });

    it.each(['short', '!!!!!!!', 'ZZZZZZZ', '00000000', ''])('rejects invalid token %s', (token) => {
        expect(decodePointIdToken(token)).toBeNull();
    });
});
