import { describe, expect, it } from 'vitest';
import { isPreviewOrigin, vector } from './types';

describe('noclip message boundaries', () => {
    it('accepts the preview deployment and local development, not suffix or path lookalikes', () => {
        expect(isPreviewOrigin('https://oem-noclip.pages.dev')).toBe(true);
        expect(isPreviewOrigin('http://127.0.0.1:5199')).toBe(true);
        for (const origin of [
            'https://oem-noclip.pages.dev.attacker.test',
            'https://oem-noclip.pages.dev/path',
            'null',
            'javascript:alert(1)',
        ])
            expect(isPreviewOrigin(origin)).toBe(false);
    });
    it('rejects nonfinite and incomplete camera coordinates', () => {
        expect(vector([1, 2, 3])).toBe(true);
        for (const value of [
            [1, 2],
            [1, Infinity, 3],
            [1, NaN, 3],
            ['1', 2, 3],
            {},
        ])
            expect(vector(value)).toBe(false);
    });
});
