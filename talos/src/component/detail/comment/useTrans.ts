import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import {
    OEM_AUTH_DISMISS_EVENT,
    openOemAuthModal,
} from '@/component/login/authEvents';
import { getTargetLang } from '@/locale';
import type { UGCComment } from '@/services/ugc/client';
import { clearAllTrans, clearTrans, flatList } from './commentsTree';
import { isSameLangErr } from './commentsUtils';
import {
    getCommentTranslationKey,
    requestCommentTranslations,
} from './translationCoordinator';

const PENDING_TRANSLATION_STORAGE_KEY = 'oem:pending-comment-translation:v1';

type PendingTranslation = {
    commentId: string;
    commentKey: string;
    intent: 'toggle' | 'translate';
    scopeKey: string;
    targetLang: string;
};

const readPendingTranslation = (): PendingTranslation | null => {
    try {
        const raw = window.sessionStorage.getItem(PENDING_TRANSLATION_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<PendingTranslation>;
        if (
            typeof parsed.commentId !== 'string'
            || typeof parsed.commentKey !== 'string'
            || (parsed.intent !== 'toggle' && parsed.intent !== 'translate')
            || typeof parsed.scopeKey !== 'string'
            || typeof parsed.targetLang !== 'string'
        ) {
            return null;
        }
        return parsed as PendingTranslation;
    } catch {
        return null;
    }
};

const persistPendingTranslation = (pending: PendingTranslation): void => {
    try {
        window.sessionStorage.setItem(PENDING_TRANSLATION_STORAGE_KEY, JSON.stringify(pending));
    } catch {
        // The hook ref still preserves the intent for non-redirect login flows.
    }
};

const removePendingTranslation = (): void => {
    try {
        window.sessionStorage.removeItem(PENDING_TRANSLATION_STORAGE_KEY);
    } catch {
        // Storage is optional.
    }
};

type Args = {
    locale: string;
    comments: UGCComment[];
    busyIds: Set<string>;
    isAuthenticated: boolean;
    patch: (commentId: string, patch: (comment: UGCComment) => UGCComment) => void;
    scopeKey: string;
    setBusy: (commentId: string, pending: boolean) => void;
    setComments: Dispatch<SetStateAction<UGCComment[]>>;
    setReply: Dispatch<SetStateAction<UGCComment | null>>;
    setRendered: Dispatch<SetStateAction<UGCComment | null>>;
};

export const useTrans = ({
    locale,
    comments,
    busyIds,
    isAuthenticated,
    patch,
    scopeKey,
    setBusy,
    setComments,
    setReply,
    setRendered,
}: Args) => {
    const targetLang = getTargetLang(locale);
    const targetRef = useRef(targetLang);
    const pendingRef = useRef<PendingTranslation | null>(null);

    const clearPending = useCallback(() => {
        pendingRef.current = null;
        removePendingTranslation();
    }, []);

    useEffect(() => {
        const stored = readPendingTranslation();
        if (stored?.scopeKey === scopeKey) {
            pendingRef.current = stored;
            return;
        }
        clearPending();
    }, [clearPending, scopeKey]);

    useEffect(() => {
        window.addEventListener(OEM_AUTH_DISMISS_EVENT, clearPending);
        return () => window.removeEventListener(OEM_AUTH_DISMISS_EVENT, clearPending);
    }, [clearPending]);

    useEffect(() => {
        if (targetRef.current === targetLang) return;
        targetRef.current = targetLang;
        clearPending();
        setComments(clearAllTrans);
        setReply((current) => (current ? clearTrans(current) : null));
        setRendered((current) => (current ? clearTrans(current) : null));
    }, [clearPending, setComments, setRendered, setReply, targetLang]);

    const executeTranslation = useCallback((
        comment: UGCComment,
        options?: { revealExisting?: boolean },
    ) => {
        if (busyIds.has(comment.id)) return;
        const hasCurrent = Boolean(
            comment.translatedContent && comment.translationTargetLanguage === targetLang,
        );
        if (hasCurrent) {
            patch(comment.id, (current) => ({
                ...current,
                translationHidden: options?.revealExisting ? false : !current.translationHidden,
                translationStatus: undefined,
            }));
            return;
        }
        if (comment.translatedContent && !comment.translationHidden) {
            patch(comment.id, (current) => ({
                ...current,
                translationHidden: true,
                translationStatus: undefined,
            }));
            return;
        }

        patch(comment.id, (current) => ({
            ...current,
            translatedContent: undefined,
            translationSourceLanguage: undefined,
            translationTargetLanguage: targetLang,
            translationHidden: false,
            translationStatus: 'translating',
        }));
        setBusy(comment.id, true);
        const requestKey = getCommentTranslationKey(comment, targetLang);
        void requestCommentTranslations([comment], targetLang, {
            allowLive: true,
            liveAttemptPolicy: 'always',
        })
            .then((items) => {
                const item = items.find((entry) => entry.commentId === comment.id);
                if (!item?.translatedContent) {
                    patch(comment.id, (current) => {
                        if (
                            current.translationTargetLanguage !== targetLang
                            || getCommentTranslationKey(current, targetLang) !== requestKey
                        ) return current;
                        if (item && isSameLangErr(item.error)) {
                            return clearTrans(current);
                        }
                        return {
                            ...current,
                            translationStatus: 'failed',
                        };
                    });
                    return;
                }
                patch(comment.id, (current) => {
                    if (
                        current.translationTargetLanguage !== targetLang
                        || getCommentTranslationKey(current, targetLang) !== requestKey
                    ) return current;
                    return {
                        ...current,
                        translatedContent: item.translatedContent,
                        translationSourceLanguage: item.sourceLanguage,
                        translationTargetLanguage: targetLang,
                        translationHidden: false,
                        translationStatus: undefined,
                    };
                });
            })
            .catch(() => {
                patch(comment.id, (current) => (
                    current.translationTargetLanguage === targetLang
                        && getCommentTranslationKey(current, targetLang) === requestKey
                        ? { ...current, translationStatus: 'failed' }
                        : current
                ));
            })
            .finally(() => setBusy(comment.id, false));
    }, [busyIds, patch, setBusy, targetLang]);

    useEffect(() => {
        const pending = pendingRef.current;
        if (!isAuthenticated || !pending) return;
        if (pending.scopeKey !== scopeKey || pending.targetLang !== targetLang) {
            clearPending();
            return;
        }

        const current = flatList(comments).find((comment) => comment.id === pending.commentId);
        if (!current) return;
        if (getCommentTranslationKey(current, targetLang) !== pending.commentKey) {
            clearPending();
            return;
        }

        clearPending();
        if (pending.intent === 'toggle') {
            const hasCurrent = Boolean(
                current.translatedContent && current.translationTargetLanguage === targetLang,
            );
            if (hasCurrent) executeTranslation(current);
            return;
        }
        executeTranslation(current, { revealExisting: true });
    }, [clearPending, comments, executeTranslation, isAuthenticated, scopeKey, targetLang]);

    const translate = useCallback((comment: UGCComment) => {
        if (!isAuthenticated) {
            const hasCurrent = Boolean(
                comment.translatedContent && comment.translationTargetLanguage === targetLang,
            );
            const pending: PendingTranslation = {
                commentId: comment.id,
                commentKey: getCommentTranslationKey(comment, targetLang),
                intent: hasCurrent ? 'toggle' : 'translate',
                scopeKey,
                targetLang,
            };
            pendingRef.current = pending;
            persistPendingTranslation(pending);
            openOemAuthModal('login');
            return;
        }
        executeTranslation(comment);
    }, [executeTranslation, isAuthenticated, scopeKey, targetLang]);

    return translate;
};
