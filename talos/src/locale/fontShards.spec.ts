import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    covers,
    prepareFonts,
    selectRuns,
    selectShards,
    type Manifest,
} from './fontShards';

const manifest: Manifest = {
    region: 'CN',
    version: 'v1',
    packing: { target: 1024, minimum: 512, maximum: 1536 },
    maps: ['U+4E00', 'U+4E8C', 'U+4E00-4EFF'],
    faces: {
        r: {
            base: { file: 'base.woff2', map: 0, range: 0, bytes: 10 },
            labels: { file: 'rest.woff2', map: 1, range: 2, bytes: 20 },
        },
        h: { base: { file: 'h-base.woff2', map: 0, range: 0, bytes: 30 } },
    },
};
afterEach(() => vi.unstubAllGlobals());

describe('immutable font selection', () => {
    it('loads base/remainder once and ignores cmap holes and unsupported glyphs', () => {
        const parts = selectShards(
            manifest,
            'https://cdn.test/assets/fonts/shards/v1/CN.json',
            { r: '一二二三😀', b: '一' },
        );
        expect(parts.map((part) => part.url).sort()).toEqual([
            'https://cdn.test/assets/fonts/shards/v1/base.woff2',
            'https://cdn.test/assets/fonts/shards/v1/rest.woff2',
        ]);
        expect(covers('U+20000-20002', 0x20001)).toBe(true);
        expect(covers('U+4E00,U+4E8C', 0x4e09)).toBe(false);
    });
    it('reads compact manifests that use the coverage map as unicode range', () => {
        const compact = structuredClone(manifest) as Manifest;
        delete compact.faces.r!.base!.range;
        delete compact.faces.r!.labels!.range;
        const parts = selectShards(compact, 'https://cdn.test/CN.json', {
            r: '一二',
        });
        expect(
            parts.find(
                (part) => part.face === 'r' && part.url.endsWith('base.woff2'),
            )?.range,
        ).toBe('U+4E00');
        expect(
            parts.find(
                (part) => part.face === 'r' && part.url.endsWith('rest.woff2'),
            )?.range,
        ).toBe('U+4E8C');
    });
    it('follows family order per glyph and falls through an absent JP Harmony face', () => {
        expect(
            selectRuns(manifest, 'https://cdn.test/CN.json', [
                { faces: ['h', 'r'], text: '一二' },
            ]).map((part) => part.face),
        ).toEqual(['r', 'h']);
        expect(
            selectRuns(
                { ...manifest, faces: { r: manifest.faces.r } },
                'https://cdn.test/JP.json',
                [{ faces: ['h', 'r'], text: '一' }],
            )[0].face,
        ).toBe('r');
    });
    it('does not register any face while another face is still loading or fails', async () => {
        let rejectSlow!: (reason: Error) => void;
        const slow = new Promise<FontFace>((_resolve, reject) => {
            rejectSlow = reject;
        });
        const instances: { family: string; load: () => Promise<FontFace> }[] =
            [];
        vi.stubGlobal(
            'FontFace',
            class {
                constructor(public family: string) {
                    instances.push(this);
                }
                load() {
                    return instances.indexOf(this) === 0
                        ? Promise.resolve(this as unknown as FontFace)
                        : slow;
                }
            },
        );
        const add = vi.fn();
        Object.defineProperty(document, 'fonts', {
            configurable: true,
            value: { add },
        });
        const pending = prepareFonts(
            selectShards(manifest, 'https://prepare.test/CN.json', {
                r: '一二',
            }),
            'test',
        );
        await vi.waitFor(() => expect(instances).toHaveLength(2));
        expect(add).not.toHaveBeenCalled();
        rejectSlow(new Error('network'));
        await expect(pending).rejects.toThrow('network');
        expect(add).not.toHaveBeenCalled();
    });
});
