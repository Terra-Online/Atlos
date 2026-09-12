import React, { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import classNames from 'classnames';
import { LinearBlur } from 'progressive-blur';
import styles from './comments.module.scss';
import { openOemAuthModal } from '@/component/login/authEvents';
import { useAuthStore } from '@/store/auth';
import { useLocale, useTranslateUI } from '@/locale';
import { formatRelativeTime, parseTimestamp } from '@/utils/timeFormat';
import { docsLink, linkTpl } from '@/utils/docsLink';
import type { IMarkerData } from '@/data/marker';
import {
    editUGCComment,
    listUGCComments,
    type UGCComment,
    type UGCCommentVoteValue,
} from '@/utils/ugcClient';
import ShortActions, { type ShortActionItem } from '@/component/uploader/shortActions';
import TranslateIcon from '@/assets/logos/translater.svg?react';
import LikeIcon from '@/assets/images/UI/like.svg?react';
import FlagIcon from '@/assets/images/UI/flag.svg?react';
import RecallIcon from '@/assets/images/UI/recall.svg?react';
import SubmitIcon from '@/assets/logos/submit.svg?react';
import ReplyIcon from '@/assets/logos/reply.svg?react';
import EditIcon from '@/assets/images/UI/edit.svg?react';
import ShareIcon from '@/assets/images/UI/share.svg?react';
import { usePointShareLink } from '@/utils/shareLink';
import { useCommentLink } from './useCommentLink';

import {
    flatDisplay,
    isReviewing,
    isVisible,
    patchTree,
    voteDelta,
} from './commentsTree';
import {
    getCommentSubmissionSnapshot,
    mergeCommentSubmissions,
    removeCommentSubmission,
    restoreCommentSubmission,
    submitCommentOptimistic,
    subscribeCommentSubmissions,
    syncCommentSubmissions,
} from './commentSubmissionStore';
import {
    avatarIndex,
    commentText,
    isTransShown,
    statusLabel,
    transNote,
} from './commentsUtils';
import { useFlagSync, useVoteSync } from './useActionSync';
import { useInputLayout } from './useInputLayout';
import { useRecall } from './useRecall';
import { useReplyQuote } from './useReplyQuote';
import { useTrans } from './useTrans';
import { useAutoTrans } from './useAutoTrans';

type Props = {
    point: IMarkerData;
    pointName: string;
    active?: boolean;
};

const COMMENT_MAX_LENGTH = 200;
const COMMENT_TOGGLE_SYNC_DELAY_MS = 300;
const COMMENT_REPLY_QUOTE_TRANSITION_MS = 180;
const RECALL_CONFIRM_MIN_DELAY_MS = 1_000;
const RECALL_CONFIRM_EXPIRE_MS = 5_000;

const CommentAvatar = memo(({ comment }: { comment: UGCComment }) => (
    <span className={styles.commentAvatar} data-avt={avatarIndex(comment)} aria-hidden="true"></span>
));

type CommentExcerptProps = {
    comment: UGCComment;
    displayDepth?: number;
    actions?: React.ReactNode;
    highlighted?: boolean;
};

export const CommentExcerpt = memo(({
    comment,
    displayDepth = 0,
    actions,
    highlighted,
}: CommentExcerptProps) => {
    const tUI = useTranslateUI();
    const locale = useLocale();
    const createdAt = useMemo(() => parseTimestamp(comment.createdAt), [comment.createdAt]);
    const timeLabel = createdAt
        ? formatRelativeTime(createdAt, { locale })
        : '';
    const status = statusLabel(comment, timeLabel, tUI);
    const authorName = comment.author?.nickname;
    const note = transNote(comment, tUI);

    return (
        <div
            data-comment-id={comment.id}
            data-highlighted={highlighted ? 'true' : undefined}
            className={classNames(styles.commentNode, { [styles.replyNode]: displayDepth > 0 })}
            style={{ '--comment-display-depth': displayDepth } as React.CSSProperties}
        >
            <article
                className={styles.commentBubble}
                data-short-actions-root={actions ? 'true' : undefined}
            >
                {actions}
                <div
                    className={classNames(styles.commentMeta, {
                        [styles.reviewing]: isReviewing(comment.status),
                    })}
                    data-status={status}
                >
                    <CommentAvatar comment={comment} />
                    <span className={styles.commentAuthor}>{authorName}</span>
                </div>
                <p
                    className={styles.commentBody}
                    data-translation-note={note || undefined}
                    data-translation-status={comment.translationStatus || undefined}
                >
                    {commentText(comment)}
                </p>
            </article>
        </div>
    );
});

type CommentItemProps = {
    point: IMarkerData;
    highlighted: boolean;
    comment: UGCComment;
    displayDepth: number;
    isOwn: boolean;
    canEditOthers: boolean;
    canInteract: boolean;
    actionPending: boolean;
    isEditing: boolean;
    recallConfirming: boolean;
    onVote: (comment: UGCComment, value: 1 | -1) => void;
    onFlag: (comment: UGCComment) => void;
    onEdit: (comment: UGCComment) => void;
    onRecall: (comment: UGCComment) => void;
    onTranslate: (comment: UGCComment) => void;
    onReply: (comment: UGCComment) => void;
    onToolbarDismiss: () => void;
};

const CommentItem = memo(({
    point,
    highlighted,
    comment,
    displayDepth,
    isOwn,
    canEditOthers,
    canInteract,
    actionPending,
    isEditing,
    recallConfirming,
    onVote,
    onFlag,
    onEdit,
    onRecall,
    onTranslate,
    onReply,
    onToolbarDismiss,
}: CommentItemProps) => {
    const tUI = useTranslateUI();
    const canModerate = isVisible(comment.status);
    const canEdit = canModerate || isReviewing(comment.status);
    const translationVisible = isTransShown(comment);
    const { copyPointShareUrl, copiedPopupVisible } = usePointShareLink(point, { content: { kind: 'comment', id: comment.id } });
    const actions = useMemo<ShortActionItem[]>(() => {
        const items: ShortActionItem[] = [
            {
                id: 'share',
                label: copiedPopupVisible ? tUI('detail.copied') : tUI('detail.comments.copyLink'),
                icon: <ShareIcon />,
                tooltipVisible: copiedPopupVisible ? true : undefined,
                disabled: !canInteract || !canModerate || comment.id.startsWith('local-comment:'),
                onClick: () => void copyPointShareUrl(),
            },
            {
                id: 'translate',
                label: translationVisible ? tUI('detail.comments.showOriginal') : tUI('detail.comments.translate'),
                icon: <TranslateIcon />,
                active: translationVisible,
                disabled: !canInteract || !canModerate || actionPending,
                onClick: () => onTranslate(comment),
            },
            {
                id: 'upvote',
                label: tUI('detail.comments.upvote'),
                icon: <LikeIcon />,
                active: comment.viewerVote === 1,
                disabled: !canInteract || !canModerate || actionPending,
                onClick: () => onVote(comment, 1),
            },
            {
                id: 'downvote',
                label: tUI('detail.comments.downvote'),
                icon: <LikeIcon />,
                active: comment.viewerVote === -1,
                disabled: !canInteract || !canModerate || actionPending,
                onClick: () => onVote(comment, -1),
            },
        ];

        if (!isOwn) {
            items.push({
                id: 'flag',
                label: comment.flagged ? tUI('detail.viewer.unflag') : tUI('detail.viewer.flag'),
                icon: <FlagIcon />,
                active: Boolean(comment.flagged),
                disabled: !canInteract || !canModerate || actionPending,
                tooltipKey: `flag:${comment.flagged ? 'on' : 'off'}:${comment.id}`,
                onClick: () => onFlag(comment),
            });
        }

        if (isOwn || canEditOthers) {
            items.push({
                id: 'edit',
                label: tUI('detail.comments.edit'),
                icon: <EditIcon />,
                disabled: !canInteract || !canEdit || actionPending,
                onClick: () => onEdit(comment),
            });
        }

        if (isOwn) {
            items.push({
                id: 'recall',
                label: tUI(recallConfirming
                    ? 'common.confirmAgain'
                    : (isEditing || comment.editUndoAvailable
                        ? 'detail.comments.undoEdit'
                        : 'detail.comments.recall')),
                icon: <RecallIcon />,
                active: Boolean(comment.recallRequested || comment.status === 'remove_request'),
                confirming: recallConfirming,
                tooltipKey: `recall:${recallConfirming ? 'confirm' : 'idle'}:${comment.id}`,
                disabled: !canInteract || actionPending || comment.status === 'stale',
                onClick: () => onRecall(comment),
            });
        }

        items.push({
            id: 'reply',
            label: tUI('detail.comments.reply'),
            icon: <ReplyIcon />,
            disabled: !canInteract || !canModerate || actionPending,
            onClick: () => onReply(comment),
        });

        return items;
    }, [
        copiedPopupVisible,
        copyPointShareUrl,
        actionPending,
        canInteract,
        canEdit,
        canModerate,
        canEditOthers,
        comment,
        isEditing,
        isOwn,
        recallConfirming,
        onFlag,
        onEdit,
        onRecall,
        onReply,
        onTranslate,
        onVote,
        tUI,
        translationVisible,
    ]);

    return (
        <CommentExcerpt
            highlighted={highlighted}
            comment={comment}
            displayDepth={displayDepth}
            actions={(
                <ShortActions
                    className={styles.commentActions}
                    anchorClassName={styles.commentActionsAnchor}
                    items={actions}
                    ariaLabel={tUI('detail.comments.actions')}
                    variant="floating"
                    onFloatingDismiss={onToolbarDismiss}
                />
            )}
        />
    );
});

const Comments = ({ point, pointName, active = true }: Props) => {
    const tUI = useTranslateUI();
    const locale = useLocale();
    const user = useAuthStore((state) => state.sessionUser);
    const isAuthenticated = Boolean(user);
    const [comments, setComments] = useState<UGCComment[]>([]);
    const [loading, setLoading] = useState(true);
    const [inputValue, setInputValue] = useState('');
    const [editTarget, setEditTarget] = useState<UGCComment | null>(null);
    const [recallConfirmation, setRecallConfirmation] = useState<{
        key: string;
        armedAt: number;
    } | null>(null);
    const [actionPendingIds, setActionPendingIds] = useState<Set<string>>(() => new Set());
    const [error, setError] = useState('');
    const clearRecallConfirmation = useCallback(() => setRecallConfirmation(null), []);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);
    const inputBarRef = useRef<HTMLDivElement | null>(null);
    const commentsPanelRef = useRef<HTMLElement | null>(null);
    const commentListRef = useRef<HTMLDivElement | null>(null);
    const handledSubmissionErrorRef = useRef(0);
    const submissionSnapshot = useSyncExternalStore(
        subscribeCommentSubmissions,
        () => getCommentSubmissionSnapshot(point.id),
        () => getCommentSubmissionSnapshot(''),
    );
    const {
        target: replyTarget,
        setTarget: setReplyTarget,
        clear: clearReply,
        rendered: renderedReply,
        setRendered: setRenderedReply,
        visible: replyVisible,
    } = useReplyQuote(COMMENT_REPLY_QUOTE_TRANSITION_MS);
    const loadFailedText = tUI('detail.comments.loadFailed');

    const setCommentActionPending = useCallback((commentId: string, pending: boolean) => {
        setActionPendingIds((current) => {
            const next = new Set(current);
            if (pending) {
                next.add(commentId);
            } else {
                next.delete(commentId);
            }
            return next;
        });
    }, []);

    const patchComment = useCallback((commentId: string, patch: (comment: UGCComment) => UGCComment) => {
        setComments((current) => patchTree(current, commentId, patch));
    }, []);

    const requireAuth = useCallback(() => {
        if (isAuthenticated) return true;
        openOemAuthModal('login');
        return false;
    }, [isAuthenticated]);

    const { start: syncVote, clear: clearVote } = useVoteSync(COMMENT_TOGGLE_SYNC_DELAY_MS, patchComment);
    const { start: syncFlag, clear: clearFlag } = useFlagSync(COMMENT_TOGGLE_SYNC_DELAY_MS, patchComment);
    const clearSync = useCallback((commentIds: Set<string>) => {
        clearVote(commentIds);
        clearFlag(commentIds);
    }, [clearFlag, clearVote]);
    const commentsWithSubmissions = useMemo(() => (
        mergeCommentSubmissions(comments, submissionSnapshot)
    ), [comments, submissionSnapshot]);
    const submittingCommentIds = useMemo(() => (
        new Set(submissionSnapshot.submittingIds)
    ), [submissionSnapshot]);
    const { blurVisible, updateBlur } = useInputLayout({
        comments: commentsWithSubmissions,
        error,
        inputValue,
        loading,
        rendered: renderedReply,
        visible: replyVisible,
        inputRef,
        inputBarRef,
        listRef: commentListRef,
        panelRef: commentsPanelRef,
    });
    const handleTranslate = useTrans({
        locale,
        comments,
        busyIds: actionPendingIds,
        isAuthenticated,
        patch: patchComment,
        scopeKey: point.id,
        setBusy: setCommentActionPending,
        setComments,
        setReply: setReplyTarget,
        setRendered: setRenderedReply,
    });
    const recallComment = useRecall({
        markerId: point.id,
        comments,
        busyIds: actionPendingIds,
        replyTarget,
        requireAuth,
        setBusy: setCommentActionPending,
        setComments,
        setReply: setReplyTarget,
        clearSync,
    });
    useAutoTrans({
        comments,
        locale,
        scopeKey: point.id,
        setComments,
    });

    const hasComments = commentsWithSubmissions.length > 0;
    const inputDisabled = !active;
    const userUid = user?.uid;
    const canEditOthers = user?.role === 'a' || user?.role === 'r';

    useEffect(() => {
        let disposed = false;
        setLoading(true);
        setError('');
        setComments([]);

        void listUGCComments(point.id)
            .then((nextComments) => {
                if (!disposed) {
                    syncCommentSubmissions(point.id, nextComments);
                    setComments(nextComments);
                }
            })
            .catch(() => {
                if (!disposed) {
                    setComments([]);
                    setError(loadFailedText);
                }
            })
            .finally(() => {
                if (!disposed) setLoading(false);
            });

        return () => {
            disposed = true;
        };
    }, [loadFailedText, point.id]);

    useEffect(() => {
        clearReply();
        setEditTarget(null);
        setInputValue('');
        setRecallConfirmation(null);
    }, [clearReply, point.id]);

    useEffect(() => {
        if (!recallConfirmation) return undefined;
        const remaining = RECALL_CONFIRM_EXPIRE_MS - (Date.now() - recallConfirmation.armedAt);
        const timer = window.setTimeout(
            () => setRecallConfirmation(null),
            Math.max(0, remaining),
        );
        return () => window.clearTimeout(timer);
    }, [recallConfirmation]);

    useEffect(() => {
        const lastError = submissionSnapshot.lastError;
        if (!lastError || lastError.id === handledSubmissionErrorRef.current) return;

        handledSubmissionErrorRef.current = lastError.id;
        setError(tUI('detail.comments.submitFailed'));
    }, [submissionSnapshot.lastError, tUI]);

    const handleReply = useCallback((comment: UGCComment) => {
        setEditTarget(null);
        setInputValue('');
        setReplyTarget(comment);
        window.requestAnimationFrame(() => {
            inputRef.current?.focus();
        });
    }, [setReplyTarget]);

    const handleEdit = useCallback((comment: UGCComment) => {
        clearReply();
        setEditTarget(comment);
        setInputValue(comment.content);
        window.requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.setSelectionRange(comment.content.length, comment.content.length);
        });
    }, [clearReply]);

    const executeRecall = useCallback((comment: UGCComment) => {
        if (editTarget?.id === comment.id) {
            setEditTarget(null);
            setInputValue('');
            return;
        }
        recallComment(comment);
    }, [editTarget, recallComment]);

    const handleRecall = useCallback((comment: UGCComment) => {
        const mode = editTarget?.id === comment.id || comment.editUndoAvailable ? 'undo' : 'recall';
        const key = `${comment.id}:${mode}`;
        const now = Date.now();
        if (recallConfirmation?.key !== key) {
            setRecallConfirmation({ key, armedAt: now });
            return;
        }
        if (now - recallConfirmation.armedAt < RECALL_CONFIRM_MIN_DELAY_MS) return;

        setRecallConfirmation(null);
        executeRecall(comment);
    }, [editTarget, executeRecall, recallConfirmation]);

    const handleSubmit = useCallback(async () => {
        const content = inputValue.trim();
        if (!content) return;
        if (!requireAuth()) return;

        setError('');
        if (editTarget) {
            if (content === editTarget.content) {
                setEditTarget(null);
                setInputValue('');
                return;
            }

            const previousComments = comments;
            const pendingComment: UGCComment = {
                ...editTarget,
                content,
                translatedContent: undefined,
                translationSourceLanguage: undefined,
                translationTargetLanguage: undefined,
                translationHidden: undefined,
                translationStatus: undefined,
                flagged: false,
                recallRequested: false,
                status: 'pending_openai',
                editUndoAvailable: true,
            };
            const previousSubmission = removeCommentSubmission(point.id, editTarget.id);
            restoreCommentSubmission(point.id, pendingComment);
            patchComment(editTarget.id, () => pendingComment);
            setCommentActionPending(editTarget.id, true);
            setEditTarget(null);
            setInputValue('');
            try {
                const submission = await editUGCComment(editTarget.id, content);
                removeCommentSubmission(point.id, editTarget.id);
                restoreCommentSubmission(point.id, {
                    ...pendingComment,
                    status: submission.status,
                });
            } catch {
                removeCommentSubmission(point.id, editTarget.id);
                if (previousSubmission) {
                    restoreCommentSubmission(point.id, previousSubmission);
                }
                setComments(previousComments);
                setEditTarget(editTarget);
                setInputValue(content);
                setError(tUI('detail.comments.editFailed'));
            } finally {
                setCommentActionPending(editTarget.id, false);
            }
            return;
        }

        submitCommentOptimistic(point, content, replyTarget, user);
        setInputValue('');
        clearReply();
    }, [clearReply, comments, editTarget, inputValue, patchComment, point, replyTarget, requireAuth, setCommentActionPending, tUI, user]);

    const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (
            event.key === 'Backspace'
            && !event.nativeEvent.isComposing
            && inputValue.length === 0
            && (replyTarget || editTarget)
        ) {
            event.preventDefault();
            if (editTarget) {
                setEditTarget(null);
            } else {
                clearReply();
            }
            return;
        }

        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        void handleSubmit();
    }, [clearReply, editTarget, handleSubmit, inputValue.length, replyTarget]);

    const handleVote = useCallback((comment: UGCComment, value: 1 | -1) => {
        if (!requireAuth()) return;
        const nextVote: UGCCommentVoteValue = comment.viewerVote === value ? 0 : value;
        const previousVote = comment.viewerVote ?? 0;
        patchComment(comment.id, (item) => ({
            ...item,
            viewerVote: nextVote,
            score: item.score + voteDelta(previousVote, nextVote),
        }));
        syncVote(comment.id, previousVote, nextVote);
    }, [patchComment, requireAuth, syncVote]);

    const handleFlag = useCallback((comment: UGCComment) => {
        if (!requireAuth()) return;
        const nextFlagged = !comment.flagged;
        patchComment(comment.id, (item) => ({
            ...item,
            flagged: nextFlagged,
            status: nextFlagged ? 'flagged' : item.status === 'flagged' ? 'active' : item.status,
        }));
        syncFlag(comment.id, Boolean(comment.flagged), nextFlagged);
    }, [patchComment, requireAuth, syncFlag]);

    const ruleUrl = useMemo(() => docsLink(locale, 'communityGuidelines'), [locale]);
    const footerText = hasComments
        ? linkTpl(tUI('detail.comments.ruleOnly'), ruleUrl)
        : linkTpl(tUI('detail.comments.emptyWithRule'), ruleUrl);
    const displayComments = useMemo(() => flatDisplay(commentsWithSubmissions), [commentsWithSubmissions]);
    const { highlightedId } = useCommentLink({
        markerId: point.id, active, loading, comments: commentsWithSubmissions, setComments, listRef: commentListRef,
    });
    const replyQuoteShown = Boolean(renderedReply && replyVisible);
    const replyQuoteText = renderedReply
        ? commentText(renderedReply)
        : '';

    return (
        <section
            ref={commentsPanelRef}
            className={styles.commentsPanel}
            data-replying={replyQuoteShown ? 'true' : 'false'}
            aria-label={`${pointName}}`}
        >
            <div
                className={styles.commentList}
                data-loading={loading ? 'true' : 'false'}
                data-comment-list="true"
                ref={commentListRef}
                onScroll={updateBlur}
            >
                {displayComments.map(({ comment, displayDepth }) => (
                    <CommentItem
                        point={point}
                        highlighted={highlightedId === comment.id}
                        key={comment.id}
                        comment={comment}
                        displayDepth={displayDepth}
                        isOwn={comment.author?.publicUid === userUid}
                        canEditOthers={canEditOthers}
                        canInteract={active}
                        actionPending={actionPendingIds.has(comment.id) || submittingCommentIds.has(comment.id)}
                        isEditing={editTarget?.id === comment.id}
                        recallConfirming={recallConfirmation?.key === `${comment.id}:${
                            editTarget?.id === comment.id || comment.editUndoAvailable ? 'undo' : 'recall'
                        }`}
                        onVote={handleVote}
                        onFlag={handleFlag}
                        onEdit={handleEdit}
                        onRecall={handleRecall}
                        onTranslate={handleTranslate}
                        onReply={handleReply}
                        onToolbarDismiss={clearRecallConfirmation}
                    />
                ))}
                {loading && comments.length === 0 && (
                    <div className={styles.commentStatus}>{tUI('common.loading')}</div>
                )}
                {error && (
                    <div className={styles.commentStatus}>{error}</div>
                )}
                <div
                    className={styles.commentDivider}
                    data-has-comments={hasComments ? 'true' : 'false'}
                    aria-hidden="true"
                ></div>
                <div className={styles.commentRule}>{footerText}</div>
            </div>
            <LinearBlur
                side="bottom"
                strength={8}
                falloffPercentage={100}
                className={classNames(styles.commentBottomBlur, {
                    [styles.commentBottomBlurVisible]: blurVisible,
                })}
            />
            <div
                className={styles.commentInputBar}
                data-replying={replyQuoteShown ? 'true' : 'false'}
                ref={inputBarRef}
            >
                <div className={styles.commentInputStack}>
                    <div
                        className={styles.commentReplyQuoteShell}
                        data-visible={replyQuoteShown ? 'true' : 'false'}
                        aria-hidden={!replyQuoteShown}
                    >
                        <div className={styles.commentReplyQuote}>
                            {replyQuoteText}
                        </div>
                    </div>
                    <div className={styles.commentInputRow}>
                        <textarea
                            ref={inputRef}
                            className={styles.commentInput}
                            value={inputValue}
                            maxLength={COMMENT_MAX_LENGTH}
                            placeholder={tUI('detail.comments.placeholder')}
                            disabled={inputDisabled}
                            onChange={(event) => setInputValue(event.target.value)}
                            onKeyDown={handleKeyDown}
                            rows={1}
                        />
                        <button
                            type="button"
                            className={styles.commentSubmit}
                            disabled={inputDisabled || inputValue.trim().length === 0}
                            onClick={() => void handleSubmit()}
                            aria-label={tUI(editTarget ? 'detail.comments.submitEdit' : 'detail.comments.submit')}
                        >
                            <SubmitIcon />
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default Comments;
