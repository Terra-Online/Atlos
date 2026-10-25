import { afterEach, describe, expect, it, vi } from 'vitest';
import { columnCount } from './windowMath';
import { WindowStore } from './windowStore';
import { selectorItem } from './model';

function fixture() {
    const root = document.createElement('div'), scroll = document.createElement('div'), grid = document.createElement('div');
    scroll.dataset.sidebarScroll = 'true'; root.append(scroll); scroll.append(grid); document.body.append(root);
    grid.style.gridTemplateColumns = '100px 100px'; grid.style.gridAutoRows = '50px'; grid.style.columnGap = '10px';
    Object.defineProperty(scroll, 'clientHeight', { value: 200 });
    scroll.getBoundingClientRect = () => new DOMRect(0, 0, 210, 200);
    grid.getBoundingClientRect = () => new DOMRect(0, -scroll.scrollTop, 210, 2500);
    const items = Array.from({ length: 100 }, (_, index) => selectorItem({ key: `item-${index}`, category: { main: 'files', sub: 'archives' } }, { total: 1, collected: 0 }, '', key => key));
    const store = new WindowStore(window), detach = store.attach(root), unregister = store.register(grid, items, true, 2);
    return { root, scroll, grid, store, cleanup: () => { unregister(); detach(); root.remove(); } };
}
afterEach(() => vi.useRealTimers());

describe('sidebar window geometry', () => {
    it('reads hidden-grid repeat tracks without counting spaces inside minmax()', () => {
        expect(columnCount('repeat(2, minmax(0px, 1fr))', 2)).toBe(2);
        expect(columnCount('100px 100px 100px', 2)).toBe(3);
        expect(columnCount('none', 2)).toBe(2);
    });
    it('bounds mounted rows while retaining selection geometry for unmounted items', () => {
        vi.useFakeTimers();
        const f = fixture();
        try {
            expect(f.store.blocks.get(f.grid)?.rows).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
            const targets = f.store.targets();
            expect(targets).toHaveLength(100);
            expect(targets[99].element).toBeUndefined();
            expect(targets[99].rect).toEqual({ left: 110, right: 210, top: 2450, bottom: 2500 });
            f.scroll.scrollTop = 2000; f.scroll.dispatchEvent(new Event('scroll'));
            expect(f.store.blocks.get(f.grid)?.rows).toContain(40);
            vi.advanceTimersByTime(101);
            expect(f.store.blocks.get(f.grid)?.rows).not.toContain(0);
            expect(f.store.blocks.get(f.grid)!.rows.length).toBeLessThanOrEqual(14);
            f.grid.dataset.expanded = 'false';
            expect(f.store.targets()).toEqual([]);
        } finally { f.cleanup(); }
    });
    it('defers look-ahead rows but marks a viewport miss urgent even if its range is already requested', () => {
        const f = fixture();
        try {
            const block = f.store.blocks.get(f.grid)!;
            block.mounted = [...block.rows];
            f.scroll.scrollTop = 100; f.scroll.dispatchEvent(new Event('scroll'));
            expect(block.rows).toContain(9);
            expect(block.urgent).toBe(false);
            f.scroll.scrollTop = 1000; f.scroll.dispatchEvent(new Event('scroll'));
            expect(block.urgent).toBe(true);
            const notified = vi.fn(), unsubscribe = f.store.subscribe(notified);
            f.scroll.dispatchEvent(new Event('scroll'));
            expect(notified).toHaveBeenCalledOnce();
            unsubscribe();
        } finally { f.cleanup(); }
    });
    it('never anchors a closed drawer to a hidden grid', () => {
        const f = fixture();
        try {
            f.grid.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
            f.store.measure(true);
            expect(f.store.anchor).toBeUndefined();
            expect(f.store.blocks.get(f.grid)?.rows).toEqual([]);
            f.grid.getBoundingClientRect = () => new DOMRect(0, 0, 210, 2500);
            f.store.measure(true);
            expect(f.scroll.scrollTop).toBe(0);
            expect(f.store.blocks.get(f.grid)?.rows).toContain(0);
        } finally { f.cleanup(); }
    });
    it('does not restore an old anchor over a scrollbar jump before its scroll event', () => {
        const f = fixture();
        try {
            f.scroll.scrollTop = 2000;
            f.store.measure(true);
            expect(f.scroll.scrollTop).toBe(2000);
            expect(f.store.blocks.get(f.grid)?.rows).toContain(40);
        } finally { f.cleanup(); }
    });
    it('keeps the top pinned when search results move the selector grid down', () => {
        const f = fixture();
        try {
            f.grid.getBoundingClientRect = () => new DOMRect(0, 300 - f.scroll.scrollTop, 210, 2500);
            f.store.measure(true);
            expect(f.scroll.scrollTop).toBe(0);
            f.grid.getBoundingClientRect = () => new DOMRect(0, -f.scroll.scrollTop, 210, 2500);
            f.store.measure(true);
            expect(f.scroll.scrollTop).toBe(0);
        } finally { f.cleanup(); }
    });
    it('drops a selector anchor while the search input is focused', () => {
        const f = fixture();
        try {
            f.scroll.scrollTop = 1000; f.scroll.dispatchEvent(new Event('scroll'));
            expect(f.store.anchor?.key).toBe('item-40');
            const input = document.createElement('input');
            input.dataset.searchInput = 'true'; f.scroll.prepend(input); input.focus();
            f.grid.style.gridTemplateColumns = '70px 70px 70px';
            f.store.measure(true);
            expect(f.scroll.scrollTop).toBe(1000);
            expect(f.store.anchor).toBeUndefined();
            input.blur(); f.store.measure(true);
            expect(f.store.anchor?.key).toBe('item-60');
        } finally { f.cleanup(); }
    });
    it('keeps a visible key when responsive layout replaces its entire grid', () => {
        const f = fixture();
        try {
            f.scroll.scrollTop = 1000; f.scroll.dispatchEvent(new Event('scroll'));
            const items = f.store.blocks.get(f.grid)!.items;
            const replacement = document.createElement('div');
            replacement.style.gridTemplateColumns = '70px 70px 70px'; replacement.style.gridAutoRows = '50px';
            replacement.getBoundingClientRect = () => new DOMRect(0, -f.scroll.scrollTop, 210, 1700);
            // Unregister through the same lifecycle as SelectorRows on a mode switch.
            const unregister = f.store.register(f.grid, items, true, 2);
            unregister(); f.grid.remove(); f.scroll.append(replacement);
            const release = f.store.register(replacement, items, true, 3);
            expect(f.scroll.scrollTop).toBe(650);
            release();
        } finally { f.cleanup(); }
    });
    it('preserves the first visible key when the column count changes', () => {
        const f = fixture();
        try {
            f.scroll.scrollTop = 1000; f.scroll.dispatchEvent(new Event('scroll'));
            f.grid.style.gridTemplateColumns = '70px 70px 70px';
            f.store.measure(true);
            expect(f.scroll.scrollTop).toBe(650);
        } finally { f.cleanup(); }
    });
});
