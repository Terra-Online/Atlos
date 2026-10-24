import { memo, startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { useAppDocument } from '@/platform/pictureInPicture';
import { useLayoutVersion } from '@/store/uiPrefs';
import type { SelectorItem } from './model';
import { WindowStore, WindowContext, useSidebarWindow } from './windowStore';
import { preloadSidebarIcons } from './sidebarIconPrefetch';
import { getItemIconUrl } from '@/services/assets/resource';

export function SidebarWindow({ containerRef, children }: { containerRef: RefObject<HTMLDivElement | null>; children: ReactNode }) {
    const document = useAppDocument();
    const store = useMemo(() => new WindowStore(document?.defaultView ?? null), [document]);
    useLayoutEffect(() => {
        const root = containerRef.current;
        if (root) return store.attach(root);
        return undefined;
    }, [containerRef, store]);
    return <WindowContext.Provider value={store}>{children}</WindowContext.Provider>;
}

type RenderItem = (item: SelectorItem, index: number, style: CSSProperties) => ReactNode;
// Retained rows keep their style and callback identity when neighbours enter the window.
const Row = memo(function Row({ item, index, columns, positioned, renderItem }: { item: SelectorItem; index: number; columns: number; positioned: boolean; renderItem: RenderItem }) {
    return renderItem(item, index, positioned ? { gridRow: Math.floor(index / columns) + 1, gridColumn: index % columns + 1 } : {});
});

export function SelectorRows({ items, columns = 2, compact = false, renderItem }: {
    items: SelectorItem[];
    columns?: number;
    compact?: boolean;
    renderItem: RenderItem;
}) {
    const store = useSidebarWindow();
    const ref = useRef<HTMLDivElement>(null);
    const version = useLayoutVersion();
    const [snapshot, setSnapshot] = useState<{ rows: number[]; columns: number }>({ rows: [], columns });
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element || !store) return undefined;
        let requested: number[] | undefined;
        let requestedColumns = columns;
        const update = () => {
            const block = store.blocks.get(element);
            if (!block) return;
            if (requested === block.rows && requestedColumns === block.columns && !block.urgent) return;
            requested = block.rows; requestedColumns = block.columns;
            const next = { rows: block.rows, columns: block.columns };
            if (block.urgent) {
                if (store.scrolling) {
                    // Only newly visible rows block a scroll. Layout effects during
                    // this commit must not recursively enter flushSync.
                    store.scrolling = false;
                    try { flushSync(() => setSnapshot(next)); } finally { store.scrolling = true; }
                } else setSnapshot(next);
            } else startTransition(() => setSnapshot(next));
        };
        const unsubscribe = store.subscribe(update);
        const unregister = store.register(element, items, compact, columns);
        update();
        return () => { unsubscribe(); unregister(); };
    }, [store, items, compact, columns, version]);
    const rows = snapshot.rows;
    useLayoutEffect(() => {
        const block = ref.current ? store?.blocks.get(ref.current) : undefined;
        if (block) { block.mounted = rows; block.urgent = false; }
    }, [rows, store]);
    useEffect(() => {
        const element = ref.current, block = element ? store?.blocks.get(element) : undefined;
        if (!element || !block || !store?.scroll) return;
        const center = store.scroll.scrollTop + store.scroll.clientHeight / 2;
        const prioritized = [...rows].sort((a, b) => Math.abs(block.top + a * block.rowHeight - center) - Math.abs(block.top + b * block.rowHeight - center));
        const urls = prioritized.flatMap(row => items.slice(row * block.columns, (row + 1) * block.columns).map(item => getItemIconUrl(item.typeInfo.icon ?? item.typeInfo.key, 'webp')));
        return preloadSidebarIcons(urls, element.ownerDocument);
    }, [store, rows, items]);
    // Isolated consumers outside a sidebar provider retain ordinary grid rendering.
    const visible = store ? new Set(rows) : null;
    const count = store ? snapshot.columns : columns;
    const rowSize = compact ? '3.2rem' : '3.95rem';
    return <div ref={ref} data-sidebar-rows="true" style={{ display: 'grid', gridColumn: '1 / -1', gridTemplateColumns: compact ? `repeat(${columns}, minmax(0, 1fr))` : `var(--mark-filter-columns, repeat(${columns}, minmax(0, 1fr)))`,
        gridAutoRows: rowSize, columnGap: '.75rem', height: store ? `calc(${Math.ceil(items.length / count)} * ${rowSize})` : undefined, overflowAnchor: 'none' }}>
        {items.map((item, index) => !visible || visible.has(Math.floor(index / count)) ? <Row key={item.typeInfo.key} item={item} index={index} columns={count} positioned={!!store} renderItem={renderItem} /> : null)}
    </div>;
}
