import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { useAuthStore } from '@/store/auth';
import { getTargetLang } from '@/lib/i18n/lang';
import type { UGCComment } from '@/services/ugc/client';
import { flatList, isVisible } from './commentsTree';
import {
    getCommentTranslationKey,
    requestCommentTranslations,
} from './translationCoordinator';

const AUTO_TRANS_TARGET_LANGS = new Set(['zh-cn', 'en-us', 'ru-ru', 'ja-jp', 'ko-kr']);
const ZH_HANT_AUTO_DISPLAY_TARGET_LANG = 'zh-cn';

type AutoTransRequest = {
    cacheOnly: boolean;
    skipChineseSource: boolean;
    targetLang: string;
};

const isTraditionalChineseTarget = (targetLang: string): boolean => (
    targetLang === 'zh-hk'
    || targetLang === 'zh-tw'
    || targetLang.startsWith('zh-hant')
);

const isChineseSource = (sourceLang?: string): boolean => {
    const normalized = sourceLang?.trim().replace('_', '-').toLowerCase();
    return Boolean(normalized && (normalized === 'zh' || normalized.startsWith('zh-')));
};

const getAutoTransRequest = (locale: string): AutoTransRequest | null => {
    const targetLang = getTargetLang(locale);
    if (isTraditionalChineseTarget(targetLang)) {
        return {
            cacheOnly: true,
            skipChineseSource: true,
            targetLang: ZH_HANT_AUTO_DISPLAY_TARGET_LANG,
        };
    }
    if (!AUTO_TRANS_TARGET_LANGS.has(targetLang)) return null;
    return {
        cacheOnly: false,
        skipChineseSource: false,
        targetLang,
    };
};

const applyAutoTrans = (
    comments: UGCComment[],
    trans: Awaited<ReturnType<typeof requestCommentTranslations>>,
    request: AutoTransRequest,
    requestedKeyById: Map<string, string>,
): UGCComment[] => {
    const transById = new Map(
        trans
            .filter((item) => (
                item.translatedContent
                && !(request.skipChineseSource && isChineseSource(item.sourceLanguage))
            ))
            .map((item) => [item.commentId, item] as const),
    );
    if (transById.size === 0) return comments;

    const applyTo = (items: UGCComment[]): UGCComment[] => {
        let changed = false;
        const nextItems = items.map((comment) => {
            const transItem = transById.get(comment.id);
            const replies = comment.replies.length > 0 ? applyTo(comment.replies) : comment.replies;
            const requestedKey = requestedKeyById.get(comment.id);
            if (
                !transItem
                || !requestedKey
                || getCommentTranslationKey(comment, request.targetLang) !== requestedKey
            ) {
                if (replies === comment.replies) return comment;
                changed = true;
                return { ...comment, replies };
            }

            const translationChanged = (
                comment.translatedContent !== transItem.translatedContent
                || comment.translationSourceLanguage !== transItem.sourceLanguage
                || comment.translationTargetLanguage !== transItem.targetLanguage
                || comment.translationHidden !== false
                || comment.translationStatus !== undefined
            );
            if (!translationChanged && replies === comment.replies) return comment;
            changed = true;
            return {
                ...comment,
                replies,
                translatedContent: transItem.translatedContent,
                translationSourceLanguage: transItem.sourceLanguage,
                translationTargetLanguage: transItem.targetLanguage,
                translationHidden: false,
                translationStatus: undefined,
            };
        });
        return changed ? nextItems : items;
    };

    return applyTo(comments);
};

const clearSkippedAutoTrans = (
    comments: UGCComment[],
    request: AutoTransRequest,
): UGCComment[] => {
    if (!request.skipChineseSource) return comments;

    const applyTo = (items: UGCComment[]): UGCComment[] => {
        let changed = false;
        const nextItems = items.map((comment) => {
            const replies = comment.replies.length > 0 ? applyTo(comment.replies) : comment.replies;
            const shouldClear = (
                comment.translationTargetLanguage?.toLowerCase() === request.targetLang
                && isChineseSource(comment.translationSourceLanguage)
            );
            if (!shouldClear) {
                if (replies === comment.replies) return comment;
                changed = true;
                return { ...comment, replies };
            }

            changed = true;
            return {
                ...comment,
                replies,
                translatedContent: undefined,
                translationSourceLanguage: undefined,
                translationTargetLanguage: undefined,
                translationHidden: undefined,
                translationStatus: undefined,
            };
        });
        return changed ? nextItems : items;
    };

    return applyTo(comments);
};

export const useAutoTrans = ({
    comments,
    enabled = true,
    locale,
    scopeKey,
    setComments,
}: {
    comments: UGCComment[];
    enabled?: boolean;
    locale: string;
    scopeKey: string;
    setComments: Dispatch<SetStateAction<UGCComment[]>>;
}) => {
    const isAuthenticated = useAuthStore((state) => Boolean(state.sessionUser));
    const requestRef = useRef('');

    useEffect(() => {
        if (!enabled || !scopeKey) return;

        const request = getAutoTransRequest(locale);
        if (!request) return;

        setComments((current) => clearSkippedAutoTrans(current, request));

        const { cacheOnly, targetLang } = request;
        const candidates = flatList(comments)
            .filter((comment) => isVisible(comment.status))
            .filter((comment) => !(
                comment.translatedContent
                && comment.translationTargetLanguage?.toLowerCase() === targetLang
            ));
        if (candidates.length === 0) return;

        const allowLive = isAuthenticated && !cacheOnly;
        const requestedKeyById = new Map(
            candidates.map((comment) => (
                [comment.id, getCommentTranslationKey(comment, targetLang)] as const
            )),
        );
        const requestKey = `${scopeKey}:${allowLive ? 'live' : 'cache'}:${[...requestedKeyById.values()].join(',')}`;
        if (requestRef.current === requestKey) return;
        requestRef.current = requestKey;

        let disposed = false;
        void requestCommentTranslations(candidates, targetLang, {
            allowLive,
            liveAttemptPolicy: 'once',
        })
            .then((items) => {
                if (disposed) return;
                setComments((current) => applyAutoTrans(current, items, request, requestedKeyById));
            })
            .catch(() => {
                // Auto translation is opportunistic; keep original comments on failure.
            });

        return () => {
            disposed = true;
        };
    }, [comments, enabled, isAuthenticated, locale, scopeKey, setComments]);
};
