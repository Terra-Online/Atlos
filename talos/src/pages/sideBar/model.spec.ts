import { describe, expect, it } from 'vitest';
import type { IMarkerType } from '@/data/marker';
import type { BinderGroup } from '@/data/marker/binder';
import { binderItem, selectorItem } from './model';

const type = (key: string, extra = {}): IMarkerType => ({ key, category: { main: 'files', sub: 'archives' }, ...extra });
const labels: Record<string, string> = { 'markerType.FileCtgr.records': '档案分类', 'markerType.drop.fixture': 'Fixture' };
const translate = (key: string) => labels[key];

describe('sidebar visibility model', () => {
    it('matches localized binder tokens without mounting selectors, but excludes unavailable types', () => {
        const info = type('one', { ctgr: 'Records' });
        expect(selectorItem(info, { total: 1, collected: 0 }, '档案', translate).visible).toBe(true);
        expect(selectorItem(info, { total: 0, collected: 0 }, '档案', translate).visible).toBe(false);
        expect(selectorItem(info, { total: 1, collected: 0 }, 'missing', translate).visible).toBe(false);
    });
    it('sorts completed children stably and keeps aggregate counts independent of search', () => {
        const types = ['first', 'second', 'third'].map(key => type(key));
        const group: BinderGroup = { id: 'drop:fixture', dropKey: 'fixture', dropName: 'Fixture', types, sharedKey: 'drop' };
        const items = new Map(types.map((info, index) => [info.key, selectorItem(info, { total: 2, collected: index === 1 ? 2 : 0 }, '', translate)]));
        const item = binderItem(group, items, '', translate, false);
        expect(item.children.map(child => child.typeInfo.key)).toEqual(['second', 'first', 'third']);
        expect(item.count).toEqual({ total: 6, collected: 2 });
        expect(item.visible).toBe(true);
        expect(item.collapseChildren).toBe(false);
    });
    it('keeps desktop single-type binder collapsed and mobile children visible', () => {
        const info = type('only'), group: BinderGroup = { id: 'drop:fixture', dropKey: 'fixture', dropName: 'Fixture', types: [info], sharedKey: 'drop' };
        const items = new Map([[info.key, selectorItem(info, { total: 1, collected: 0 }, '', translate)]]);
        expect(binderItem(group, items, '', translate, false).collapseChildren).toBe(true);
        expect(binderItem(group, items, '', translate, true).collapseChildren).toBe(false);
    });
});
