import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

it('bounds prefetch concurrency, releases failed slots, and drops cancelled queued work', async () => {
    vi.resetModules();
    const requests: Image[] = [];
    class Image {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        decoding = '';
        src = '';
        constructor() { requests.push(this); }
        decode = () => Promise.resolve();
    }
    vi.stubGlobal('Image', Image);
    const { preloadSidebarIcons } = await import('./sidebarIconPrefetch');
    const cancel = preloadSidebarIcons(Array.from({ length: 12 }, (_, index) => `icon-${index}`), document);
    expect(requests).toHaveLength(6);
    requests[0].onerror!();
    expect(requests).toHaveLength(7);
    cancel();
    requests[1].onload!();
    await Promise.resolve();
    expect(requests).toHaveLength(7);
});
