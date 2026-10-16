import { getFontRegionForLocale, type FontRegion } from '@/lib/i18n/lang';
import { observeFontRegions } from './fontRegions';

const documents = new Map<
    Document,
    {
        regions: ReturnType<typeof observeFontRegions>;
        language: MutationObserver;
    }
>();
const detectLanguage = (doc: Document): FontRegion =>
    getFontRegionForLocale(doc.documentElement.lang || navigator.language);

/** Start observing rendered regions; font downloads never block application boot. */
export function fontLoader(doc: Document = document): Promise<void> {
    if (documents.has(doc) || !doc.fonts || typeof FontFace === 'undefined')
        return Promise.resolve();
    const regions = observeFontRegions(doc, detectLanguage(doc));
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
