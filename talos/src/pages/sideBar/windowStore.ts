import { createContext, useContext } from 'react';
import type { BoxSelectionTarget } from '@/component/selection/useBoxSelectionEngine';
import type { SelectorItem } from './model';
import { rowRange, columnCount } from './windowMath';

interface Block {
    element: HTMLDivElement;
    items: SelectorItem[];
    compact: boolean;
    fallbackColumns: number;
    columns: number;
    rowHeight: number;
    gap: number;
    top: number;
    left: number;
    width: number;
    rows: number[];
    mounted: number[];
    urgent: boolean;
    active: boolean;
    trim?: number;
}

/** One observer and scroll subscription per sidebar, shared by every selector grid. */
export class WindowStore {
    blocks = new Map<HTMLDivElement, Block>();
    listeners = new Set<() => void>();
    scrolling = false;
    scroll: HTMLElement | null = null;
    observer?: ResizeObserver;
    constructor(public view: Window | null = null) {}
    lastScrollTop = 0;
    anchor?: { key: string; element: HTMLDivElement; offset: number; category?: string };
    pendingAnchor?: WindowStore['anchor'];
    subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    notify = () => { for (const listener of this.listeners) listener(); };

    attach(root: HTMLElement) {
        const scroll = root.querySelector<HTMLElement>('[data-sidebar-scroll]');
        if (!scroll) return () => {};
        this.scroll = scroll;
        this.view = scroll.ownerDocument.defaultView;
        const Observer = scroll.ownerDocument.defaultView?.ResizeObserver;
        if (Observer) {
            this.observer = new Observer(() => this.measure(true));
            this.observer.observe(scroll);
            for (const child of scroll.children) this.observer.observe(child);
            for (const element of this.blocks.keys()) this.observe(element);
        }
        scroll.addEventListener('scroll', this.onScroll, { passive: true });
        root.addEventListener('transitionend', this.onLayout);
        this.measure(true);
        return () => {
            scroll.removeEventListener('scroll', this.onScroll);
            root.removeEventListener('transitionend', this.onLayout);
            this.observer?.disconnect(); this.observer = undefined;
            for (const block of this.blocks.values()) this.view?.clearTimeout(block.trim);
            this.scroll = null; this.anchor = undefined; this.pendingAnchor = undefined;
        };
    }
    onScroll = () => { this.anchor = undefined; this.pendingAnchor = undefined; this.scrolling = true; try { this.measure(false); } finally { this.scrolling = false; } };
    onLayout = () => this.measure(true);
    register(element: HTMLDivElement, items: SelectorItem[], compact: boolean, columns: number) {
        const previous = this.blocks.get(element);
        if (previous) this.view?.clearTimeout(previous.trim);
        const block: Block = { element, items, compact, fallbackColumns: columns, columns, rowHeight: 0, gap: 0, top: 0, left: 0, width: 0, rows: previous?.rows ?? [], mounted: previous?.mounted ?? [], urgent: true, active: false };
        this.blocks.set(element, block); this.observe(element); this.measure(true);
        return () => {
            this.view?.clearTimeout(block.trim);
            this.observer?.unobserve(element);
            const header = element.closest('[data-binder-wrap]')?.querySelector('[data-binder-keys]');
            if (header) this.observer?.unobserve(header);
            if (this.anchor?.element === element) {
                const anchor = this.anchor;
                this.pendingAnchor = anchor;
                queueMicrotask(() => {
                    if (this.pendingAnchor === anchor) { this.pendingAnchor = undefined; this.rememberAnchor(); }
                });
            }
            this.blocks.delete(element);
        };
    }
    observe(element: HTMLElement) {
        this.observer?.observe(element);
        const category = element.closest('[data-category]');
        if (category) this.observer?.observe(category);
        const header = element.closest('[data-binder-wrap]')?.querySelector('[data-binder-keys]');
        if (header) this.observer?.observe(header);
    }
    measure(layout: boolean, prune = false) {
        const scroll = this.scroll, view = this.view;
        if (!scroll || !view) return;
        // A scrollbar jump or wheel scroll can precede its asynchronous scroll event.
        // Never restore a stale layout anchor over a newer user scroll position.
        if (Math.abs(scroll.scrollTop - this.lastScrollTop) > .5) { this.anchor = undefined; this.pendingAnchor = undefined; }
        const viewport = layout ? scroll.getBoundingClientRect() : null, height = scroll.clientHeight;
        const pinnedRows = new Map<Element, Set<number>>();
        for (const element of scroll.querySelectorAll<HTMLElement>('[data-sidebar-row]:hover, [data-sidebar-row]:focus-within')) {
            const grid = element.closest('[data-sidebar-rows]');
            if (!grid) continue;
            const rows = pinnedRows.get(grid) ?? new Set<number>();
            rows.add(Number(element.dataset.sidebarRow)); pinnedRows.set(grid, rows);
        }
        let changed = false;
        for (const block of this.blocks.values()) {
            const previousColumns = block.columns;
            if (layout || !block.rowHeight) {
                const rect = block.element.getBoundingClientRect();
                block.active = rect.width > 0 && rect.height > 0;
                const style = view.getComputedStyle(block.element);
                block.columns = columnCount(style.gridTemplateColumns, block.fallbackColumns);
                block.rowHeight = parseFloat(style.gridAutoRows) || parseFloat(view.getComputedStyle(scroll.ownerDocument.documentElement).fontSize) * (block.compact ? 3.2 : 3.95);
                block.gap = parseFloat(style.columnGap) || 0;
                const bounds = viewport ?? scroll.getBoundingClientRect();
                block.top = rect.top - bounds.top - scroll.clientTop + scroll.scrollTop;
                block.left = rect.left - bounds.left - scroll.clientLeft + scroll.scrollLeft;
                block.width = rect.width;
            }
            if (!block.active) {
                this.view?.clearTimeout(block.trim); block.trim = undefined;
                block.urgent = true;
                if (block.rows.length || previousColumns !== block.columns) { block.rows = []; changed = true; }
                continue;
            }
            const count = Math.ceil(block.items.length / block.columns);
            const [first, last] = rowRange(block.top - scroll.scrollTop, height, block.rowHeight, count, height);
            const [visibleFirst, visibleLast] = rowRange(block.top - scroll.scrollTop, height, block.rowHeight, count, height, 0);
            block.urgent = layout || Array.from({ length: visibleLast - visibleFirst }, (_, index) => visibleFirst + index).some(row => !block.mounted.includes(row));
            // A transition may still be pending even when the desired range has not changed.
            // Re-notify if the viewport has caught up with that work.
            if (block.urgent && visibleLast > visibleFirst) changed = true;
            const [keepFirst, keepLast] = rowRange(block.top - scroll.scrollTop, height, block.rowHeight, count, height, 1.5);
            const pinned = pinnedRows.get(block.element) ?? new Set<number>();
            const rows = new Set(Array.from({ length: last - first }, (_, index) => first + index));
            for (const row of block.rows) if (!prune || (row >= keepFirst && row < keepLast) || pinned.has(row)) rows.add(row);
            const next = [...rows].filter(row => row < count).sort((a, b) => a - b);
            if (previousColumns !== block.columns || next.join(',') !== block.rows.join(',')) { block.rows = next; changed = true; }
            if (block.rows.some(row => (row < keepFirst || row >= keepLast) && !pinned.has(row)) && !block.trim) {
                block.trim = view.setTimeout(() => { block.trim = undefined; this.measure(false, true); }, 100);
            }
        }
        const anchor = this.pendingAnchor ?? this.anchor;
        if (layout && anchor) {
            const { key, element, offset, category } = anchor;
            const direct = this.blocks.get(element);
            const block = direct?.active ? direct : [...this.blocks.values()].find(block => block.active && block.element.closest<HTMLElement>('[data-category]')?.dataset.category === category && block.items.some(item => item.typeInfo.key === key));
            const index = block?.items.findIndex(item => item.typeInfo.key === key) ?? -1;
            if (block && index >= 0) {
                this.pendingAnchor = undefined;
                const top = block.top + Math.floor(index / block.columns) * block.rowHeight;
                if (Math.abs(top - scroll.scrollTop - offset) > .5) {
                    const behavior = scroll.style.scrollBehavior;
                    scroll.style.scrollBehavior = 'auto';
                    scroll.scrollTop = top - offset;
                    scroll.style.scrollBehavior = behavior;
                }
            }
        }
        this.lastScrollTop = scroll.scrollTop;
        this.rememberAnchor();
        if (changed) this.notify();
    }
    rememberAnchor() {
        const scroll = this.scroll;
        if (!scroll || this.pendingAnchor) return;
        let best = Infinity;
        this.anchor = undefined;
        for (const block of this.blocks.values()) {
            if (!block.active || block.element.closest('[data-expanded="false"]')) continue;
            const index = Math.max(0, Math.ceil((scroll.scrollTop - block.top) / block.rowHeight)) * block.columns;
            const item = block.items[index], top = block.top + Math.floor(index / block.columns) * block.rowHeight;
            if (item && top >= scroll.scrollTop && top < best) { best = top; this.anchor = { key: item.typeInfo.key, element: block.element, offset: top - scroll.scrollTop, category: block.element.closest<HTMLElement>('[data-category]')?.dataset.category }; }
        }
    }
    targets(): BoxSelectionTarget[] {
        this.measure(true);
        const result: BoxSelectionTarget[] = [];
        for (const block of this.blocks.values()) {
            if (!block.active || block.element.closest('[data-expanded="false"]')) continue;
            const width = (block.width - block.gap * (block.columns - 1)) / block.columns;
            block.items.forEach((item, index) => {
                const left = block.left + (index % block.columns) * (width + block.gap), top = block.top + Math.floor(index / block.columns) * block.rowHeight;
                result.push({ keys: [item.typeInfo.key], rect: { left, right: left + width, top, bottom: top + block.rowHeight - (block.compact ? 0 : block.rowHeight / 3.95 * .75) },
                    element: block.element.querySelector<HTMLElement>(`[data-sidebar-index="${index}"] [data-mark-selector-item], [data-sidebar-index="${index}"][data-mark-selector-item]`) ?? undefined,
                    mode: 'toggle' });
            });
        }
        return result;
    }
}

export const WindowContext = createContext<WindowStore | null>(null);
export function useSidebarWindow() { return useContext(WindowContext); }
