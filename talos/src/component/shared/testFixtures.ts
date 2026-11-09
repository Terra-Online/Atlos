import en from '@/locale/data/ui/en-US.json';
import type { IdCardRenderModel } from './account/idcardView';

/** Use the shipped catalog, including its ICU templates and HTML links. */
export const translate = (key: string): string => {
    let value: unknown = en;
    for (const segment of key.split('.')) {
        if (!value || typeof value !== 'object') return key;
        value = Reflect.get(value, segment);
    }
    return typeof value === 'string' ? value : key;
};

export const fontRef = (_element: HTMLElement | null) => {};
export const localeFixture = {
    useLocale: () => 'en-US',
    useTranslateUI: () => translate,
    useTranslateGame: () => (key: string) => key,
};
export const pipFixture = {
    useAppDocument: () => document,
    getAppDocument: () => document,
    getOpenerDocument: () => document,
    subscribePictureInPictureState: () => () => {},
};
export const cardProfile: IdCardRenderModel = {
    displayName: 'Explorer', uidLabel: 'UID', displayUid: '42',
    groupText: 'Member', ageText: '2 days', showAge: true, showKarma: true,
    titleLetter: 'A', karmaLevel: 2, karmaTooltip: 'Helpful contributor',
};

export function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
