import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./fontConfig', () => ({
    manifests: { CN: '/CN.json', HK: '/HK.json' },
    requirements: {},
}));

import { createFontRegions } from './fontRegions';

type Pending = {
    font: FontFace;
    resolve: (font: FontFace) => void;
    reject: (error: Error) => void;
};
let pending: Pending[];
let fonts: Set<FontFace>;
let controller: ReturnType<typeof createFontRegions>;

beforeEach(() => {
    pending = [];
    fonts = new Set();
    Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: fonts,
    });
    vi.stubGlobal(
        'FontFace',
        class {
            constructor(public family: string) {}
            load() {
                return new Promise<FontFace>((resolve, reject) =>
                    pending.push({
                        font: this as unknown as FontFace,
                        resolve,
                        reject,
                    }),
                );
            }
        },
    );
    vi.stubGlobal(
        'fetch',
        vi.fn((url: string) =>
            Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve({
                        region: url.includes('HK') ? 'HK' : 'CN',
                        version: 'v1',
                        maps: ['U+4E00', 'U+4E8C'],
                        faces: {
                            r: {
                                base: { file: 'base.woff2', map: 0, bytes: 10 },
                                extra: {
                                    file: 'extra.woff2',
                                    map: 1,
                                    bytes: 10,
                                },
                            },
                        },
                    }),
            }),
        ),
    );
    controller = createFontRegions(document, 'CN');
});

afterEach(() => {
    controller.stop();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
});

function owner(text: string) {
    const element = document.createElement('div');
    document.body.append(element);
    return {
        element,
        area: controller.register(element, [{ faces: ['r'], text }]),
    };
}
const resolve = (index: number) => pending[index].resolve(pending[index].font);

describe('shared native font shards', () => {
    it('shares pending shards without delaying a smaller owner behind an unrelated shard', async () => {
        const complete = owner('一二');
        const subset = owner('一');
        await vi.waitFor(() => expect(pending).toHaveLength(2));
        resolve(0);
        await subset.area.ready;
        expect(fonts.size).toBe(1);
        expect(complete.element.style.getPropertyValue('--font-r')).toContain(
            'pending',
        );
        resolve(1);
        await complete.area.ready;
        expect(fonts.size).toBe(2);
        expect(complete.element.style.getPropertyValue('--font-r')).toBe(
            subset.element.style.getPropertyValue('--font-r'),
        );
        subset.area.stop();
        expect(fonts.size).toBe(2);
    });

    it('reuses a prepared shard for content warmup and retains the old complete alias while growing', async () => {
        const first = owner('一');
        await vi.waitFor(() => expect(pending).toHaveLength(1));
        resolve(0);
        await first.area.ready;
        const alias = first.element.style.getPropertyValue('--font-r');
        const warm = controller.preloadRuns([{ faces: ['r'], text: '一二' }]);
        await vi.waitFor(() => expect(pending).toHaveLength(2));
        first.area.update([{ faces: ['r'], text: '一二' }]);
        expect(first.element.style.getPropertyValue('--font-r')).toBe(alias);
        expect(fonts.size).toBe(1);
        resolve(1);
        await warm;
        await first.area.ready;
        expect(pending).toHaveLength(2);
        expect(fonts.size).toBe(2);
    });

    it('does not register a late result after its content owner and document are stopped', async () => {
        const first = owner('一二');
        await vi.waitFor(() => expect(pending).toHaveLength(2));
        first.area.stop();
        controller.stop();
        resolve(0);
        resolve(1);
        await first.area.ready;
        expect(fonts.size).toBe(0);
    });

    it('keeps locale aliases distinct even when their manifests share a shard URL', async () => {
        const first = owner('一');
        await vi.waitFor(() => expect(pending).toHaveLength(1));
        resolve(0);
        await first.area.ready;
        const before = first.element.style.getPropertyValue('--font-r');
        const switchLanguage = controller.setRegion('HK');
        await vi.waitFor(() => expect(pending).toHaveLength(2));
        expect(first.element.style.getPropertyValue('--font-r')).toBe(before);
        resolve(1);
        await switchLanguage;
        expect(first.element.style.getPropertyValue('--font-r')).toContain(
            '-HK-r',
        );
        expect(fonts.size).toBe(2);
    });

    it('retries a failed shared shard instead of retaining a rejected cache entry', async () => {
        const first = owner('二');
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await vi.waitFor(() => expect(pending).toHaveLength(1));
        pending[0].reject(new Error('offline'));
        await first.area.ready;
        expect(fonts.size).toBe(0);
        const retried = controller.setRegion('CN');
        await vi.waitFor(() => expect(pending).toHaveLength(2));
        resolve(1);
        await retried;
        expect(fonts.size).toBe(1);
        warning.mockRestore();
    });
});
