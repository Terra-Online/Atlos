import { describe, expect, it } from 'vitest';
import { createRequestGuard, deepGet, mergeCatalogs } from './runtime';
import { indexFontAssets } from './fontAssets';

describe('catalog primitives', () => {
    it('merges missing nested translations while preserving explicit values and arrays', () => {
        const english = {
            group: { title: 'Title', count: '{count}' },
            items: ['a'],
            blank: 'fallback',
        };
        const merged = mergeCatalogs(english, {
            group: { title: '标题' },
            items: ['b'],
            blank: '',
        });
        expect(merged).toEqual({
            group: { title: '标题', count: '{count}' },
            items: ['b'],
            blank: '',
        });
        expect(deepGet(merged, 'group.count')).toBe('{count}');
        expect(deepGet(merged, 'absent.key')).toBeUndefined();
        expect(english.group.title).toBe('Title');
    });
    it('rejects obsolete loads even when switching back to the same locale', () => {
        const begin = createRequestGuard();
        const first = begin();
        const second = begin();
        const third = begin();
        expect(first()).toBe(false);
        expect(second()).toBe(false);
        expect(third()).toBe(true);
        expect(createRequestGuard()()()).toBe(true);
        expect(third()).toBe(true);
    });
    it('keeps app font indexes independent and skips unavailable assets', () => {
        const main = indexFontAssets({
            '/repo/src/assets/fonts/Harmony/CN.woff2': '/main.woff2',
        });
        const app = indexFontAssets({
            '../assets/fonts/Harmony/CN.woff2': '/app.woff2',
        });
        expect(main.getFontAssetUrl('Harmony/CN.woff2')).toBe('/main.woff2');
        expect(app.getFontAssetUrls(['missing', 'Harmony/CN.woff2'])).toEqual([
            '/app.woff2',
        ]);
    });
});
