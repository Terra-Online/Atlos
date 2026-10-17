import { getFontRegionForLocale, type FontRegion } from '@/lib/i18n/lang';
import { createFontRegions } from './fontRegions';
import { loadManifest, type Face, type Region } from './fontShards';
import { requirements } from './fontConfig';

const fontRegions: Region[] = ['CN', 'HK', 'JP'];

/** Warm the small region indexes while the language picker is visible. */
export function preloadFontManifests(): void {
    for (const region of fontRegions)
        void loadManifest(region).catch(() => undefined);
}

/** Warm only the selected region's current registered areas. */
export function preloadFontRegion(region: Exclude<FontRegion, null>): void {
    void loadManifest(region)
        .then(({ manifest, url }) => {
            const metadata = requirements[region];
            const parts = Object.fromEntries(
                [...new Set([
                    ...Object.keys(metadata?.ui || {}),
                    ...Object.keys(metadata?.shell || {}),
                ])].map((face) => [
                    face,
                    [
                        ...new Set([
                            ...(metadata?.ui?.[face as Face] || []),
                            ...(metadata?.shell?.[face as Face] || []),
                        ]),
                    ],
                ]),
            );
            const files = Object.entries(parts).flatMap(([face, keys]) =>
                (keys || []).flatMap((key) => {
                    const part = manifest.faces[face as Face]?.[key];
                    return part ? [new URL(part.file, url).href] : [];
                }),
            );
            return Promise.all(
                [...new Set(files)].map((file) =>
                    fetch(file, { cache: 'force-cache' }).then((response) =>
                        response.arrayBuffer(),
                    ),
                ),
            );
        })
        .catch(() => undefined);
}

const documents = new Map<
    Document,
    {
        regions: ReturnType<typeof createFontRegions>;
        language: MutationObserver;
    }
>();
const detectLanguage = (doc: Document): FontRegion =>
    getFontRegionForLocale(doc.documentElement.lang || navigator.language);

/** Start shell requests early; locale setup controls when the UI commits. */
export function fontLoader(
    doc: Document = document,
    initialRegion: FontRegion = detectLanguage(doc),
): Promise<void> {
    if (documents.has(doc) || !doc.fonts || typeof FontFace === 'undefined')
        return Promise.resolve();
    const regions = createFontRegions(doc, initialRegion);
    regions.register(doc.body);
    const language = new MutationObserver(() => {
        void regions
            .setRegion(detectLanguage(doc))
            .catch((error: unknown) =>
                console.warn('Font language switch failed:', error),
            );
    });
    language.observe(doc.documentElement, {
        attributes: true,
        attributeFilter: ['lang'],
    });
    documents.set(doc, { regions, language });
    return Promise.resolve();
}

export const switchFontRegion = (
    region: FontRegion,
    isCurrent?: () => boolean,
): Promise<void> => {
    void fontLoader();
    return Promise.all(
        [...documents.values()].map((state) =>
            state.regions.setRegion(region, isCurrent),
        ),
    ).then(() => undefined);
};

export function getCurrentRegion(): FontRegion {
    return detectLanguage(document);
}

export const stopFontLoader = (doc: Document): void => {
    const state = documents.get(doc);
    state?.language.disconnect();
    state?.regions.stop();
    documents.delete(doc);
};

const owners = new Set<() => void>();

/** Register actual component data, including interpolation and pseudo-element text. */
export function registerFontRegion(
    element: HTMLElement,
    initialRuns: import('./fontShards').TextRun[],
) {
    let runs = initialRuns;
    let doc = element.ownerDocument;
    void fontLoader(doc);
    let area = documents.get(doc)?.regions.register(element, runs);
    const migrate = () => {
        if (doc === element.ownerDocument) return;
        area?.stop();
        doc = element.ownerDocument;
        void fontLoader(doc);
        area = documents.get(doc)?.regions.register(element, runs);
    };
    owners.add(migrate);
    return {
        update(next: import('./fontShards').TextRun[]) {
            runs = next;
            migrate();
            area?.update(runs);
        },
        stop() {
            area?.stop();
            owners.delete(migrate);
        },
    };
}

/** PiP explicitly adopts existing React nodes without remounting their refs. */
export function migrateFontRegions() {
    for (const migrate of owners) migrate();
}
