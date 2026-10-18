import { describe, expect, it } from 'vitest';
import { createRequestGuard, deepGet, mergeCatalogs } from './runtime';

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
});
