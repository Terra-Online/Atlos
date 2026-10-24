import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { motion } from 'motion/react';
import MarkBinder from './markBinder';
import useRegion from '@/store/region';
import { binderItem, selectorItem } from '@/pages/sideBar/model';
import type { BinderGroup } from '@/data/marker/binder';

vi.mock('@/store/marker', () => ({
    useMarkerStore: (select: (state: { filter: string[] }) => unknown) => select({ filter: [] }),
}));
vi.mock('@/pages/markSelector/markSelector', () => ({
    default: ({ item }: { item: { typeInfo: { key: string } } }) => <div data-selector-key={item.typeInfo.key} />,
}));

const initialRegion = useRegion.getState().currentRegionKey;
afterEach(() => {
    cleanup();
    useRegion.setState({ currentRegionKey: initialRegion });
    vi.restoreAllMocks();
});

it('remeasures retained binder rows when a region reflows their parent', async () => {
    const group: BinderGroup = {
        id: 'ctgr:fixture', dropKey: 'fixture', dropName: 'Fixture', sharedKey: 'ctgr',
        types: ['first', 'second'].map(key => ({ key, category: { main: 'files', sub: 'archives' } })),
    };
    const measured: string[] = [];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const key = this.firstElementChild?.getAttribute('data-selector-key');
        const offset = useRegion.getState().currentRegionKey === 'Wuling' ? 0 : 120;
        if (key) {
            measured.push(key);
            return new DOMRect(10, offset + (key === 'first' ? 40 : 80), 180, 40);
        }
        return new DOMRect(0, 0, 200, 200 + offset);
    });
    function Category() {
        const region = useRegion(state => state.currentRegionKey);
        const items = new Map(group.types.map(type => [type.key, selectorItem(type, { total: region === 'Dijiang' ? 0 : 1, collected: 0 }, '', key => key)]));
        return <motion.div layout layoutDependency={region}><MarkBinder item={binderItem(group, items, '', key => key, false)} /></motion.div>;
    }
    useRegion.setState({ currentRegionKey: 'Dijiang' });
    const view = render(<Category />);
    // A binder can already be mounted while its current region has no rows.
    // Let its initial paint settle before the rows first appear in Wuling.
    await act(async () => {
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    });
    act(() => useRegion.setState({ currentRegionKey: 'Wuling' }));
    await waitFor(() => {
        expect(measured).toContain('first');
        expect(measured).toContain('second');
    });
    const firstRow = view.container.querySelector('[data-selector-key="first"]');
    measured.length = 0;
    act(() => useRegion.setState({ currentRegionKey: 'Valley_4' }));
    // The visible keys and their local order did not change, but their positions
    // did. Reusing their old boxes leaves Motion's parent-relative targets stale.
    await waitFor(() => {
        expect(measured).toContain('first');
        expect(measured).toContain('second');
    });
    expect(view.container.querySelector('[data-selector-key="first"]')).toBe(firstRow);
});
