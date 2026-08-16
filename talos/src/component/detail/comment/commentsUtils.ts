import { getProjectLangNameKey } from '@/locale';
import type { UGCComment } from '@/services/ugc/client';
import { isReviewing } from './commentsTree';

export const avatarIndex = (comment: UGCComment): number | undefined => {
    const index = Math.floor(comment.author?.avatar ?? 0);
    return index >= 1 ? index : undefined;
};

export const statusLabel = (
    comment: UGCComment,
    timeLabel: string,
    tUI: (key: string) => string,
): string => {
    if (isReviewing(comment.status)) {
        return tUI('detail.comments.reviewing')
    }
    return timeLabel;
};

const langLabel = (
    sourceLang: string | undefined,
    tUI: (key: string) => string,
): string => {
    const key = getProjectLangNameKey(sourceLang);
    if (!key) return '';

    return tUI(key) || key.replace(/^language\.names\./, '');
};

const tmplLabel = (template: string, fallback: string, languageLabel?: string): string => {
    const normalized = template || fallback;
    if (!languageLabel) return normalized;
    return normalized.replace('{language}', languageLabel);
};

export const isSameLangErr = (error: string | undefined): boolean => {
    const normalized = error?.toLowerCase() ?? '';
    return normalized.includes("target language can't be equal to source language")
        || normalized.includes('target language cannot be equal to source language');
};

export const isTransShown = (comment: UGCComment): boolean => (
    Boolean(comment.translatedContent && !comment.translationHidden)
);

export const commentText = (comment: UGCComment): string => (
    isTransShown(comment) ? comment.translatedContent as string : comment.content
);

export const transNote = (comment: UGCComment, tUI: (key: string) => string): string => {
    if (comment.translationStatus === 'translating') {
        return tmplLabel(tUI('detail.comments.translating'), 'Translating');
    }

    if (comment.translationStatus === 'failed') {
        return tmplLabel(tUI('detail.comments.translateFailed'), 'Translation failed');
    }

    if (!isTransShown(comment)) return '';

    const label = langLabel(comment.translationSourceLanguage, tUI);
    if (!label) return '';

    return tmplLabel(tUI('detail.comments.translatedFrom'), 'Translated from {language}', label);
};

export const cssPx = (value: string): number => {
    return Number.parseFloat(value) || 0;
};
