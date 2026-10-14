import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { clearReadCache, getContributions, getOverview } from './client';
import { useAuthStore } from '@main/store/auth';

const { requestJson } = vi.hoisted(() => ({ requestJson: vi.fn() }));
vi.mock('@main/services/http/request', () => ({ requestJson }));
vi.mock('@hub/locale', () => ({ getCurrentLocale: () => 'en-US' }));
vi.mock('@main/services/http/authRuntime', () => ({
    getAuthBase: () => 'http://localhost:8787',
}));

beforeEach(() => {
    clearReadCache();
    requestJson.mockReset();
    useAuthStore.getState().clearSessionUser();
});
afterEach(() => vi.useRealTimers());

it('normalizes the backend profile like the map before showing an ID card', async () => {
    requestJson.mockResolvedValue({
        user: {
            uid: '100002ST',
            nickname: 'Tester',
            role: 'A',
            avatar: '2',
            karma: '3',
            registeredAt: '2026-01-01 00:00:00',
        },
        contributions: {
            imageCount: 0,
            commentCount: 0,
            pendingCount: 0,
        },
    });
    const { user } = await getOverview();
    expect(user).toMatchObject({
        groupCode: 'admin',
        titleCode: 'A',
        avatar: 2,
        karma: 3,
    });
    expect(Number(user.registeredAt)).toBe(Date.UTC(2026, 0, 1));
});

it('resolves private previews against the API origin while preserving public URLs', async () => {
    requestJson.mockResolvedValue({
        items: [
            { id: 'local', previewUrl: '/me/v1/contributions/local/preview' },
            { id: 'public', previewUrl: 'https://cdn.example/image.webp' },
            { id: 'missing', previewUrl: null },
        ],
        nextCursor: 'next',
    });
    const page = await getContributions('image');
    expect(page.items.map((item) => item.previewUrl)).toEqual([
        'http://localhost:8787/me/v1/contributions/local/preview',
        'https://cdn.example/image.webp',
        null,
    ]);
    expect(page.nextCursor).toBe('next');
});

it('coalesces remounts, expires reads, and isolates changed sessions', async () => {
    vi.useFakeTimers();
    const page = { items: [], nextCursor: null };
    requestJson.mockResolvedValue(page);
    const controller = new AbortController();
    const first = getContributions('image', undefined, controller.signal);
    controller.abort();
    const second = getContributions('image');
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).resolves.toEqual(page);
    expect(requestJson).toHaveBeenCalledOnce();
    await getContributions('image');
    await getContributions('comment');
    await getContributions('image', 'page-two');
    expect(requestJson).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(15_001);
    await getContributions('image');
    expect(requestJson).toHaveBeenCalledTimes(4);
    useAuthStore
        .getState()
        .setSessionUser({ uid: 'another', nickname: 'Another' });
    await getContributions('image');
    expect(requestJson).toHaveBeenCalledTimes(5);
});

it('does not retain failed reads and allows an explicit refresh', async () => {
    requestJson
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue({
            user: { uid: '1', nickname: 'Tester' },
            contributions: {},
        });
    await expect(getOverview()).rejects.toThrow('offline');
    await Promise.all([getOverview(), getOverview()]);
    expect(requestJson).toHaveBeenCalledTimes(2);
    clearReadCache();
    await getOverview();
    expect(requestJson).toHaveBeenCalledTimes(3);
});
