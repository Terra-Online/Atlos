import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flush } from '../../testSetup';
import type { Contribution } from '../../types';
import List from './list';

vi.mock('@main/data/marker', () => ({
    loadAllMarkers: () =>
        Promise.resolve([{ id: '42', type: 'sample', subregId: 'WL_12' }]),
    MARKER_TYPE_DICT: { sample: { category: { main: 'nature' } } },
}));
vi.mock('@main/services/map/subregionLabel', () => ({
    getSubregionLabel: () => '应龙关',
}));
vi.mock('@main/locale', () => ({ useTranslateGame: () => () => '醚质' }));
vi.mock('@hub/locale', () => ({
    getCurrentLocale: () => 'zh-CN',
    useLocale: () => 'zh-CN',
    useTranslateUI: () => (key: string) =>
        ({
            'userHub.pointSeparator': '・',
            'userHub.commentLocation': ', 于「{point}」',
        })[key] ?? key,
}));

const item: Contribution = {
    id: 'comment',
    kind: 'comment',
    markerId: '42',
    poiType: 'sample',
    content: '愿我们在天上的父垂怜。',
    previewUrl: null,
    snapshotId: 'snapshot-comment',
    revision: 1,
    reviewStatus: 'pending_openai',
    authorDeletedAt: null,
    adminDeletedAt: null,
    review: {
        events: [],
        manual: false,
        published: false,
        path: [
            { key: 'uploaded', at: '2026-05-21T03:28:31Z' },
            { key: 'ai', at: null },
        ],
        times: {
            uploaded: '2026-05-21T03:28:31Z',
            ai: null,
            manual: null,
            public: null,
            archived: null,
        },
    },
    status: 'pending_openai',
    visibility: 'private',
    createdAt: '2026-05-21T03:28:31Z',
};
let node: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
    node = document.createElement('div');
    document.body.append(node);
    root = createRoot(node);
});
afterEach(async () => {
    await flush(() => root.unmount());
    node.remove();
    vi.useRealTimers();
});
const render = (overrides: Partial<Contribution> = {}) =>
    flush(() =>
        root.render(
            createElement(List, {
                kind: 'comment',
                items: [{ ...item, ...overrides }],
            }),
        ),
    );
const stages = () => [...node.querySelectorAll('ol li')];

it('shows the comment before its dated point label and the default three stages', async () => {
    await render();
    expect(node.querySelector('p')?.textContent).toBe(item.content);
    expect(node.querySelector('time')?.textContent).toMatch(/^2026-05-21 /);
    expect(node.querySelector('time')?.parentElement?.textContent).toContain(
        '于「醚质・应龙关」',
    );
    expect(stages()).toHaveLength(3);
    expect(stages().map((el) => el.getAttribute('data-state'))).toEqual([
        'complete',
        'current',
        'pending',
    ]);
    expect(
        node.querySelector('[aria-current="step"]')?.getAttribute('aria-label'),
    ).toContain('userHub.steps.ai.current');
});

it('retains the manual stage after publication and highlights the public node', async () => {
    await render({
        status: 'active',
        review: {
            ...item.review,
            manual: true,
            published: true,
            path: ['uploaded', 'ai', 'manual', 'public'].map((key) => ({
                key: key as Key,
                at: null,
            })),
        },
    });
    expect(stages()).toHaveLength(4);
    expect(stages().map((el) => el.getAttribute('data-state'))).toEqual([
        'complete',
        'complete',
        'complete',
        'current',
    ]);
    expect(
        node.querySelector('[aria-current="step"]')?.getAttribute('aria-label'),
    ).toContain('userHub.steps.public.complete');
});

it('does not mark publication as completed when an author deletes before approval', async () => {
    await render({
        status: 'stale',
        authorDeletedAt: '2026-05-21T03:29:31Z',
        review: {
            ...item.review,
            manual: true,
            published: false,
            path: ['uploaded', 'manual', 'archived'].map((key) => ({
                key: key as Key,
                at: null,
            })),
        },
    });
    expect(stages()).toHaveLength(3);
    expect(stages().map((el) => el.getAttribute('data-state'))).toEqual([
        'complete',
        'complete',
        'current',
    ]);
    expect(
        node.querySelector('[aria-current="step"]')?.getAttribute('aria-label'),
    ).toContain('userHub.steps.archived.complete');
});

it('shows the exact and relative node time without inventing missing timestamps', async () => {
    vi.setSystemTime(new Date('2026-05-21T03:30:31Z'));
    await render({
        status: 'active',
        review: {
            ...item.review,
            manual: true,
            published: true,
            path: [
                { key: 'uploaded', at: item.createdAt },
                { key: 'ai', at: '2026-05-21T03:28:31Z' },
                { key: 'manual', at: '2026-05-21T03:29:31Z' },
                { key: 'public', at: '2026-05-21T03:29:31Z' },
            ],
            times: {
                archived: null,
                uploaded: item.createdAt,
                ai: '2026-05-21T03:28:31Z',
                manual: '2026-05-21T03:29:31Z',
                public: '2026-05-21T03:29:31Z',
            },
        },
    });
    const trigger = stages()[1].querySelector('[aria-describedby]');
    expect(trigger).not.toBeNull();
    const tooltip = node.querySelector(
        `[id="${trigger?.getAttribute('aria-describedby')}"]`,
    );
    expect(tooltip?.getAttribute('role')).toBe('tooltip');
    expect(tooltip?.textContent).toMatch(
        /^userHub\.steps\.ai\.complete - 2026-05-21 \d{2}:28:31 \(2分钟前\)$/,
    );
    expect(tooltip?.querySelector('br')).toBeNull();
    expect(tooltip?.querySelector('time')?.textContent).toMatch(
        /^2026-05-21 \d{2}:28:31 \(2分钟前\)$/,
    );
    expect(tooltip?.querySelector('time')?.getAttribute('dateTime')).toBe(
        '2026-05-21T03:28:31.000Z',
    );
    expect(stages()[1].hasAttribute('title')).toBe(false);
    await render({
        status: 'active',
        review: {
            ...item.review,
            published: true,
            path: ['uploaded', 'ai', 'public'].map((key) => ({
                key: key as Key,
                at: null,
            })),
        },
    });
    expect(stages()[2].querySelector('[role="tooltip"]')?.textContent).toBe(
        'userHub.steps.public.complete',
    );
    expect(stages()[2].querySelector('time')).toBeNull();
});

type Key = 'uploaded' | 'ai' | 'manual' | 'public' | 'archived';
const paths: Key[][] = [
    ['uploaded', 'manual', 'archived'],
    ['uploaded', 'ai', 'archived'],
    ['uploaded', 'archived'],
    ['uploaded', 'ai', 'manual', 'archived'],
    ['uploaded', 'ai', 'public', 'manual', 'archived'],
    ['uploaded', 'manual', 'archived', 'manual', 'public'],
];
it.each(paths.map((keys) => ({ keys })))(
    'shows only the recorded path without grey intermediate nodes: %j',
    async ({ keys }) => {
        await render({
            status: keys.at(-1) === 'public' ? 'active' : 'stale',
            review: {
                ...item.review,
                manual: keys.some((key) => key === 'manual'),
                published: keys.some((key) => key === 'public'),
                path: keys.map((key) => ({ key, at: null })),
            },
        });
        expect(stages()).toHaveLength(keys.length);
        expect(
            stages().some((el) => el.getAttribute('data-state') === 'pending'),
        ).toBe(false);
        expect(stages().map((el) => el.getAttribute('aria-label'))).toEqual(
            keys.map((key) =>
                key === 'uploaded'
                    ? 'userHub.steps.uploaded'
                    : `userHub.steps.${key}.complete`,
            ),
        );
        expect(node.querySelector('[role="tooltip"]')?.textContent).toBe(
            'userHub.steps.uploaded',
        );
        expect(node.querySelector('ol time')).toBeNull();
    },
);

it('links directly to the comment or image on its point', async () => {
    await render();
    const point = node.querySelector<HTMLAnchorElement>('a');
    expect(point?.textContent).toBe('醚质・应龙关');
    expect(point?.href).toMatch(
        /^https:\/\/oem.re\/[a-zA-Z0-9]{7}\?commentId=comment$/,
    );
    const href = point?.href;
    await flush(() =>
        root.render(
            createElement(List, {
                kind: 'image',
                items: [
                    {
                        ...item,
                        kind: 'image',
                        previewUrl: 'https://cdn.example/photo.webp',
                    },
                ],
            }),
        ),
    );
    expect(node.querySelector('a')?.href).toBe(
        href?.replace('commentId=comment', 'imageId=comment'),
    );
    expect(node.querySelector('a img')?.getAttribute('src')).toBe(
        'https://cdn.example/photo.webp',
    );
    expect(node.querySelector('a ol')).toBeNull();
});
