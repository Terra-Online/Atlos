import { afterEach, expect, it, vi } from 'vitest';
import { encodePointIdToken } from '@/services/routing/pointToken';

afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
});

it('builds nearest-route links from the configured viewer and existing point-token contract', async () => {
    vi.stubEnv(
        'VITE_WORLD_URL',
        'http://127.0.0.1:5176/old?release=stale#camera',
    );
    vi.resetModules();
    const { previewLink } = await import('./client');
    const url = new URL(previewLink('37900210001', { planRoute: 'nearest' }));
    expect(url.origin).toBe('http://127.0.0.1:5176');
    expect(url.pathname).toBe('/' + encodePointIdToken('37900210001'));
    expect([...url.searchParams]).toEqual([['planRoute', 'nearest']]);
    expect(url.hash).toBe('');
});

it('preserves the normal point preview URL without route planning', async () => {
    vi.stubEnv(
        'VITE_WORLD_URL',
        'https://world.opendfieldmap.org/old?planRoute=nearest#camera',
    );
    vi.resetModules();
    const { previewLink } = await import('./client');
    const url = new URL(previewLink('37900210001'));
    expect(url.pathname).toBe('/' + encodePointIdToken('37900210001'));
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
});
