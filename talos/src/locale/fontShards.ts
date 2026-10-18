import type { FontRegion } from '@/lib/i18n/lang';
import { manifests as manifestPaths } from './fontConfig';

export const faceKeys = ['b', 'db', 'm', 'r', 'h'] as const;
export type Face = (typeof faceKeys)[number];
export type Region = Exclude<FontRegion, null>;
export type Demand = Partial<Record<Face, string>>;
interface Part {
    file: string;
    map: number;
    /** Older beta manifests duplicated `map` as `range`; compact manifests omit it. */
    range?: number;
    bytes: number;
}
export interface Manifest {
    region: Region;
    version: string;
    packing: { target: number; minimum: number; maximum: number };
    maps: string[];
    faces: Partial<Record<Face, Record<string, Part>>>;
}
export interface Selection {
    face: Face;
    url: string;
    range: string;
    bytes: number;
}

const rangeIndex = (part: Part): number => part.range ?? part.map;

type Span = [number, number];
const ranges = new Map<string, Span[]>();
const parseRanges = (range: string): Span[] => {
    let parsed = ranges.get(range);
    if (!parsed) {
        parsed = range
            .split(',')
            .filter(Boolean)
            .map((entry) => {
                const [first, last = first] = entry.slice(2).split('-');
                return [parseInt(first, 16), parseInt(last, 16)];
            });
        ranges.set(range, parsed);
    }
    return parsed;
};
export const covers = (range: string, point: number): boolean =>
    parseRanges(range).some(([first, last]) => point >= first && point <= last);

const indexes = new WeakMap<
    Manifest,
    Partial<Record<Face, [number, number, string][]>>
>();
const findPart = (
    manifest: Manifest,
    face: Face,
    point: number,
): string | undefined => {
    let index = indexes.get(manifest);
    if (!index) {
        index = {};
        indexes.set(manifest, index);
    }
    let spans = index[face];
    if (!spans) {
        spans = Object.entries(manifest.faces[face] || {})
            .flatMap(([key, part]) =>
                parseRanges(manifest.maps[part.map]).map(
                    ([first, last]): [number, number, string] => [
                        first,
                        last,
                        key,
                    ],
                ),
            )
            .sort((a, b) => a[0] - b[0]);
        index[face] = spans;
    }
    let low = 0,
        high = spans.length - 1;
    while (low <= high) {
        const middle = (low + high) >>> 1;
        const [first, last, key] = spans[middle];
        if (point < first) high = middle - 1;
        else if (point > last) low = middle + 1;
        else return key;
    }
    return undefined;
};

export const selectShards = (
    manifest: Manifest,
    url: string,
    demand: Demand,
): Selection[] => {
    const result: Selection[] = [];
    for (const face of faceKeys) {
        const parts = manifest.faces[face];
        if (!parts) continue;
        const selected = new Set<string>();
        for (const char of new Set([
            ...(demand[face] || ''),
            ...(demand[face] || '').normalize('NFC'),
        ])) {
            const point = char.codePointAt(0)!;
            const key = findPart(manifest, face, point);
            if (key) selected.add(key);
        }
        for (const key of [...selected].sort()) {
            const part = parts[key];
            result.push({
                face,
                url: new URL(part.file, url).href,
                range: manifest.maps[rangeIndex(part)],
                bytes: part.bytes,
            });
        }
    }
    return result;
};

export interface TextRun {
    faces: Face[];
    text: string;
    /** Catalog text is replaced at language commit; persistent user content is not. */
    localized?: 'ui' | 'game';
}
/** Follow the existing family order per glyph, including a missing JP Harmony face. */
export const selectRuns = (
    manifest: Manifest,
    url: string,
    runs: TextRun[],
): Selection[] => {
    const characters = new Map<Face, Set<string>>();
    for (const run of runs)
        for (const char of new Set([
            ...run.text,
            ...run.text.normalize('NFC'),
        ])) {
            const point = char.codePointAt(0)!;
            for (const face of run.faces) {
                if (findPart(manifest, face, point)) {
                    if (!characters.has(face)) characters.set(face, new Set());
                    characters.get(face)!.add(char);
                    break;
                }
            }
        }
    return selectShards(
        manifest,
        url,
        Object.fromEntries(
            [...characters].map(([face, chars]) => [face, [...chars].join('')]),
        ),
    );
};

const manifests = new Map<
    Region,
    Promise<{ manifest: Manifest; url: string }>
>();
const fontBytes = new Map<string, Promise<ArrayBuffer>>();

const loadFontBytes = (url: string): Promise<ArrayBuffer> => {
    let pending = fontBytes.get(url);
    if (!pending) {
        // The selected language is a user-visible transaction. Chromium and
        // WebKit honor this optional hint; browsers that do not support it
        // simply ignore the extra RequestInit field.
        const init: RequestInit & { priority?: 'high' } = {
            cache: 'force-cache',
            priority: 'high',
        };
        pending = fetch(url, init).then((response) => {
            if (!response.ok)
                throw new Error(`Font shard HTTP ${response.status}`);
            return response.arrayBuffer();
        });
        fontBytes.set(url, pending);
        void pending.catch(() => {
            if (fontBytes.get(url) === pending) fontBytes.delete(url);
        });
    }
    return pending;
};

/** Warm immutable shard bytes so the later FontFace load does not requeue the URL. */
export const preloadFontBytes = (urls: string[]): Promise<void> =>
    Promise.all([...new Set(urls)].map((url) => loadFontBytes(url))).then(
        () => undefined,
    );

export const loadManifest = (region: Region) => {
    let pending = manifests.get(region);
    if (!pending) {
        pending = (async () => {
            const path = manifestPaths[region];
            if (!path) throw new Error(`Font manifest unavailable: ${region}`);
            const url = new URL(path, document.baseURI).href;
            const response = await fetch(url);
            if (!response.ok)
                throw new Error(`Font manifest HTTP ${response.status}`);
            const manifest = (await response.json()) as Manifest;
            if (manifest.region !== region || manifest.version !== 'v1')
                throw new Error('Font manifest version/region mismatch');
            return { manifest, url };
        })();
        manifests.set(region, pending);
        void pending.catch(() => manifests.delete(region));
    }
    return pending;
};

export interface Prepared {
    fonts: FontFace[];
    families: Partial<Record<Face, string>>;
}
/** Load without registering any face; the caller commits the entire set together. */
export const prepareFonts = async (
    selection: Selection[],
    alias: string,
): Promise<Prepared> => {
    const families: Partial<Record<Face, string>> = {};
    const fonts = await Promise.all(
        selection.map(async (part) => {
            const family = `Atlos-${alias}-${part.face}`;
            families[part.face] = family;
            let source: string | ArrayBuffer = `url(${JSON.stringify(part.url)})`;
            const bytes = fontBytes.get(part.url);
            if (bytes) {
                try {
                    source = await bytes;
                } catch {
                    // A failed speculative prefetch should not make the
                    // visible area fail; FontFace can retry the URL itself.
                }
            }
            const font = new FontFace(
                family,
                source,
                {
                    unicodeRange: part.range,
                    weight: part.face === 'h' ? '100 900' : 'normal',
                    style: 'normal',
                },
            );
            await font.load();
            return font;
        }),
    );
    return { fonts, families };
};
