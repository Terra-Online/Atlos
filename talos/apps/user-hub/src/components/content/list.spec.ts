import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flush } from '../../testSetup';
import type { Contribution } from '../../types';
import List from './list';
import { formatDate } from '../../config';

vi.mock('@main/data/marker', () => ({
    loadAllMarkers: () =>
        Promise.resolve([{ id: '42', type: 'sample', subregId: 'WL_12' }]),
    MARKER_TYPE_DICT: { sample: { category: { main: 'nature' } } },
}));
vi.mock('@main/services/map/subregionLabel', () => ({
    getSubregionLabel: () => '应龙关',
}));
vi.mock('@main/locale', () => ({ useTranslateGame: () => () => '醚质' }));
const locale = vi.hoisted(() => ({ value: 'zh-CN' }));
vi.mock('@hub/locale', () => ({
    getCurrentLocale: () => locale.value,
    useLocale: () => locale.value,
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
    status: 'pending_openai',
    visibility: 'private',
    createdAt: '2026-05-21T03:28:31Z',
};
let node: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
    locale.value = 'zh-CN';
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
        review: { manual: true, published: true },
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

it('does not mark publication as completed when a submission was recalled before approval', async () => {
    await render({
        status: 'stale',
        review: { manual: true, published: false },
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
            manual: true,
            published: true,
            times: {
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
        review: { manual: false, published: true },
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

it('formats comment dates using the current app locale and recomputes them after a language change', async () => {
    locale.value = 'en-US';
    await render();
    const time = node.querySelector('time')!;
    expect(time.textContent).toBe(formatDate(item.createdAt, 'en-US'));
    locale.value = 'de-DE';
    await render();
    expect(time.textContent).toBe(formatDate(item.createdAt, 'de-DE'));
    expect(time.textContent).not.toBe(formatDate(item.createdAt, 'en-US'));
});

it('falls back for failed image previews and resets that failure when the preview URL changes', async () => {
    const renderImage = (previewUrl: string) => flush(() => root.render(createElement(List, { kind: 'image', items: [{ ...item, kind: 'image', previewUrl }] })));
    await renderImage('/first.webp');
    await flush(() => node.querySelector('img')?.dispatchEvent(new Event('error')));
    expect(node.querySelector('img')).toBeNull();
    expect(node.textContent).toContain('userHub.previewUnavailable');
    await renderImage('/second.webp');
    expect(node.querySelector('img')?.getAttribute('src')).toBe('/second.webp');
});
