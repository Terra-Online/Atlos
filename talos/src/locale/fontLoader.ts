import { getFontRegionForLocale, type FontRegion } from '@/lib/i18n/lang';
import { createFontRegions } from './fontRegions';

const documents = new Map<
    Document,
    {
        regions: ReturnType<typeof createFontRegions>;
        language: MutationObserver;
    }
>();
const detectLanguage = (doc: Document): FontRegion =>
    getFontRegionForLocale(doc.documentElement.lang || navigator.language);

/** Load the build-time shell requirements without blocking application boot. */
export function fontLoader(
    doc: Document = document,
    initialRegion: FontRegion = detectLanguage(doc),
): Promise<void> {
    if (documents.has(doc) || !doc.fonts || typeof FontFace === 'undefined')
        return Promise.resolve();
    const regions = createFontRegions(doc, initialRegion);
    regions.register(doc.body);
    const language = new MutationObserver(() =>
        regions.setRegion(detectLanguage(doc)),
    );
    language.observe(doc.documentElement, {
        attributes: true,
        attributeFilter: ['lang'],
    });
    documents.set(doc, { regions, language });
    return Promise.resolve();
}

export const switchFontRegion = (region: FontRegion): Promise<void> => {
    void fontLoader();
    documents.get(document)?.regions.setRegion(region);
    return Promise.resolve();
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
