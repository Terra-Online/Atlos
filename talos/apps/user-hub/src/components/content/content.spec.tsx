import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installResizeObserver } from '../../../../../test-support/browser';
import { flush } from '../../testSetup';
import Content from './content';

const api = vi.hoisted(() => ({ pages: vi.fn() }));
vi.mock('../../api/client', () => ({ getContributions: api.pages, isUnauthorized: () => false }));
vi.mock('@hub/locale', () => ({ useLocale: () => 'en-US', getCurrentLocale: () => 'en-US', useTranslateUI: () => (key: string) => key }));
vi.mock('@main/locale', () => ({ useTranslateGame: () => (key: string) => key }));
vi.mock('@main/locale/useFontRegion', () => ({ useFontRegion: () => () => {} }));
vi.mock('@main/data/marker', () => ({ loadAllMarkers: () => Promise.resolve([]), MARKER_TYPE_DICT: {} }));

type Observer = { targets: Set<Element>; callback: (entries: { isIntersecting: boolean }[]) => void };
const observers: Observer[] = [];
beforeEach(() => {
    api.pages.mockReset();
    observers.length = 0;
    installResizeObserver();
    vi.stubGlobal('IntersectionObserver', class {
        targets = new Set<Element>();
        constructor(readonly callback: Observer['callback']) { observers.push(this); }
        observe(element: Element) { this.targets.add(element); }
        disconnect() { this.targets.clear(); }
    });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('coordinates automatic pagination, retry UI and retained list items without duplicate near-viewport requests', async () => {
    const item = { id: 'a', kind: 'image', markerId: '42', poiType: 'ore', content: null, status: 'active', visibility: 'public', createdAt: '2026-05-21T03:28:31Z' };
    let failPage!: (reason: Error) => void;
    const page = new Promise<never>((_resolve, reject) => { failPage = reject; });
    api.pages.mockResolvedValueOnce({ items: [item], nextCursor: 'next' }).mockReturnValueOnce(page).mockResolvedValueOnce({ items: [{ ...item, id: 'b' }], nextCursor: null });
    let view!: ReturnType<typeof render>;
    await flush(() => { view = render(<Content revision={0} counts={{ imageCount: 1200, commentCount: 0, pendingCount: 0 }} />); });
    expect(screen.getByRole('tab', { name: 'userHub.kinds.image (1,200)' }).getAttribute('aria-selected')).toBe('true');
    const observer = observers.find((entry) => entry.targets.size > 0)!;
    await flush(() => { observer.callback([{ isIntersecting: true }]); observer.callback([{ isIntersecting: true }]); });
    expect(api.pages).toHaveBeenCalledTimes(2);
    expect(api.pages.mock.calls[1][1]).toBe('next');
    await flush(() => failPage(new Error('offline')));
    expect(screen.getByRole('alert').textContent).toContain('offline');
    expect(view.container.querySelectorAll('ul > li')).toHaveLength(1);
    expect(observer.targets.size).toBe(0);
    expect(screen.queryByRole('button', { name: 'userHub.loadMore' })).toBeNull();
    await flush(() => { fireEvent.click(screen.getByRole('button', { name: 'userHub.retry' })); });
    expect(api.pages.mock.calls[2][1]).toBe('next');
    expect(view.container.querySelectorAll('ul > li')).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'userHub.loadMore' })).toBeNull();
});

it('resets feed scroll on kind changes and never publishes a stale response from the previous kind', async () => {
    let resolveOld!: (value: { items: never[]; nextCursor: string }) => void;
    const old = new Promise<{ items: never[]; nextCursor: string }>((resolve) => { resolveOld = resolve; });
    api.pages.mockReturnValueOnce(old).mockResolvedValueOnce({ items: [], nextCursor: null });
    await flush(() => { render(<Content revision={0} counts={{ imageCount: 1, commentCount: 2, pendingCount: 0 }} />); });
    const feed = screen.getByRole('tabpanel');
    feed.scrollTop = 100;
    await flush(() => { fireEvent.click(screen.getByRole('tab', { name: 'userHub.kinds.comment (2)' })); });
    expect(feed.scrollTop).toBe(0);
    expect(api.pages.mock.calls[1][0]).toBe('comment');
    expect((api.pages.mock.calls[0][2] as AbortSignal).aborted).toBe(true);
    await flush(() => resolveOld({ items: [], nextCursor: 'stale' }));
    expect(screen.getByText('userHub.emptyContributions')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'userHub.loadMore' })).toBeNull();
});
