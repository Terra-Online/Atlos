import { expect, it, vi } from 'vitest';
import { getOverview } from './client';

const { requestJson } = vi.hoisted(() => ({ requestJson: vi.fn() }));
vi.mock('@main/services/http/request', () => ({ requestJson }));
vi.mock('@hub/locale', () => ({ getCurrentLocale: () => 'en-US' }));

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
        loginMethods: [],
        services: { endfield: { bound: false, enabled: false } },
        contributions: {
            imageCount: 0,
            commentCount: 0,
            pendingCount: 0,
            recent: [],
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
