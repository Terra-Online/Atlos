import React, { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import classNames from 'classnames';
import styles from './uploader.module.scss';
import Viewer from '../detail/viewer/viewer';
import { getAnnouncementLocaleKey } from '@/utils/announcement';
import { openOemAuthModal } from '@/component/login/authEvents';
import { useAuthStore } from '@/store/auth';
import { useLocale, useTranslateUI } from '@/locale';
import type { IMarkerData } from '@/data/marker';
import { usePointShareLink } from '@/utils/shareLink';
import {
    listUGCImages,
    listUGCMyImages,
    resolveUGCUploadTarget,
    toggleUGCImageFlag,
    toggleUGCImageRecall,
    toggleUGCImageUpvote,
    uploadUGCImage,
    UGCClientError,
    type UGCImage,
    type UGCImageActionPatch,
    type UGCSubmissionImage,
    type UGCUploadSubmission,
} from '@/utils/ugcClient';

type Props = {
    point: IMarkerData;
    pointName: string;
};

type ImageState = 'noImage' | 'pending' | 'hasImage';

const isPending = (image: UGCSubmissionImage): boolean => (
    image.status === 'pending_openai' || image.status === 'pending_audit'
);

const isPublic = (image: UGCSubmissionImage): boolean => (
    image.status === 'active' || image.status === 'flagged' || image.status === 'remove_request'
);

const getUpvoteCount = (image: UGCImage): number => (
    Number.isFinite(image.upvotes)
        ? Math.max(0, image.upvotes as number)
        : Number.isFinite(image.upvoteCount)
            ? Math.max(0, image.upvoteCount as number)
            : 0
);

const isActionConflict = (err: unknown): boolean => (
    err instanceof UGCClientError && err.status === 409
);

const useUpload = (point: IMarkerData) => {
    const tUI = useTranslateUI();
    const locale = useLocale();
    const user = useAuthStore((state) => state.sessionUser);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const target = useMemo(() => resolveUGCUploadTarget(point), [point]);
    const [images, setImages] = useState<UGCImage[]>([]);
    const [myImages, setMyImages] = useState<UGCSubmissionImage[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [viewerOpen, setViewerOpen] = useState(false);
    const [pendingLoginUpload, setPendingLoginUpload] = useState(false);
    const [lastSubmission, setLastSubmission] = useState<UGCUploadSubmission | null>(null);
    const [actionPending, setActionPending] = useState(false);

    const errText = useCallback((err: unknown): string => {
        if (err instanceof UGCClientError) {
            const translated = tUI(`detail.errors.${err.code}`);
            const fallback = tUI(err.status ? 'detail.errors.backendUnknown' : 'detail.errors.uploadFailed');
            return typeof translated === 'string' && translated
                ? translated
                : String(fallback || 'Upload failed.');
        }

        return String(tUI('detail.errors.uploadFailed') || 'Upload failed.');
    }, [tUI]);

    useEffect(() => {
        setImages([]);
        setMyImages([]);
        setError(null);
        setLastSubmission(null);
        setViewerOpen(false);
        if (!target) return;

        let disposed = false;
        setLoading(true);
        void listUGCImages(point.id)
            .then((nextImages) => {
                if (!disposed) setImages(nextImages);
            })
            .catch(() => {
                if (!disposed) setImages([]);
            })
            .finally(() => {
                if (!disposed) setLoading(false);
            });

        if (user) {
            void listUGCMyImages(point.id)
                .then((nextImages) => {
                    if (!disposed) setMyImages(nextImages);
                })
                .catch(() => {
                    if (!disposed) setMyImages([]);
                });
        }

        return () => {
            disposed = true;
        };
    }, [point.id, target, user]);

    useEffect(() => {
        if (!pendingLoginUpload || !user) return;
        setPendingLoginUpload(false);
        requestAnimationFrame(() => inputRef.current?.click());
    }, [pendingLoginUpload, user]);

    const pointImages = useMemo(
        () => images.filter((image) => image.markerId === point.id),
        [images, point.id],
    );
    const pointMyImages = useMemo(
        () => myImages.filter((image) => image.markerId === point.id),
        [myImages, point.id],
    );
    const ownPublic = useMemo(
        () => pointMyImages.find(isPublic) ?? null,
        [pointMyImages],
    );
    const active = useMemo(() => {
        const publicActive = pointImages[0] ?? null;
        if (!publicActive) return ownPublic;

        const ownMatch = pointMyImages.find((image) => image.id === publicActive.id);
        return ownMatch
            ? {
                ...publicActive,
                ...ownMatch,
                author: publicActive.author ?? ownMatch.author,
                url: publicActive.url || ownMatch.url,
            }
            : publicActive;
    }, [ownPublic, pointImages, pointMyImages]);
    const isOwnActive = Boolean(active && pointMyImages.some((image) => image.id === active.id));
    const previewUrl = active?.url ?? '';
    const pendingOwn = useMemo(
        () => pointMyImages.find(isPending) ?? null,
        [pointMyImages],
    );
    const state: ImageState = pendingOwn || lastSubmission?.status === 'pending_openai' || lastSubmission?.status === 'pending_audit'
        ? 'pending'
        : active
            ? 'hasImage'
            : 'noImage';
    const canUpload = Boolean(target) && state !== 'hasImage' && state !== 'pending' && !uploading;
    const canPreview = Boolean(active);
    const interactive = canPreview || canUpload;
    const karma = Number.isFinite(user?.karma) ? Math.max(0, user?.karma as number) : 0;
    const showRules = canUpload && state === 'noImage' && karma < 2;
    const rulesUrl = useMemo(
        () => `https://blog.opendfieldmap.org/${getAnnouncementLocaleKey(locale)}/docs/community-guidelines`,
        [locale],
    );

    const requestUpload = useCallback(() => {
        if (!canUpload) return;
        setError(null);
        if (!user) {
            setPendingLoginUpload(true);
            openOemAuthModal('login');
            return;
        }
        inputRef.current?.click();
    }, [canUpload, user]);

    const upload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || !target) return;

        setUploading(true);
        setProgress(0.02);
        setError(null);
        setLastSubmission(null);
        try {
            const submission = await uploadUGCImage(target, file, setProgress);
            setLastSubmission(submission);
            const [nextImages, nextMyImages] = await Promise.allSettled([
                listUGCImages(point.id),
                listUGCMyImages(point.id),
            ]);
            if (nextImages.status === 'fulfilled') {
                setImages(nextImages.value);
            }
            if (nextMyImages.status === 'fulfilled') {
                setMyImages(nextMyImages.value);
            }
        } catch (err) {
            setLastSubmission(null);
            setError(errText(err));
        } finally {
            setUploading(false);
            setProgress(0);
        }
    }, [errText, point.id, target]);

    return {
        active,
        authorNickname: active?.author?.nickname ?? '',
        authorPublicUid: active?.author?.publicUid ?? '',
        canPreview,
        error,
        inputRef,
        interactive,
        loading,
        previewUrl,
        progress,
        requestUpload,
        rulesUrl,
        setViewerOpen,
        show: Boolean(target) || pointImages.length > 0,
        showRules,
        state,
        upload,
        uploading,
        viewerOpen,
        actionPending,
        isOwnActive,
        isAuthenticated: Boolean(user),
        createdAt: active?.createdAt ?? '',
        setActionPending,
        setImages,
        setMyImages,
    };
};

const Uploader = memo(({ point, pointName }: Props) => {
    const tUI = useTranslateUI();
    const {
        active,
        authorNickname,
        authorPublicUid,
        canPreview,
        createdAt,
        error,
        actionPending,
        inputRef,
        interactive,
        isAuthenticated,
        isOwnActive,
        loading,
        previewUrl,
        progress,
        requestUpload,
        rulesUrl,
        setViewerOpen,
        show,
        showRules,
        state,
        upload,
        uploading,
        viewerOpen,
        setActionPending,
        setImages,
        setMyImages,
    } = useUpload(point);
    const { copiedPopupVisible, copyPointShareUrl } = usePointShareLink(point);
    const progressStyle = useMemo(
        () => ({ '--uploader-progress': `${Math.round(progress * 100)}%` }) as CSSProperties,
        [progress],
    );

    const handleClick = useCallback(() => {
        if (canPreview) {
            setViewerOpen(true);
            return;
        }
        requestUpload();
    }, [canPreview, requestUpload, setViewerOpen]);

    const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        if (!interactive || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        handleClick();
    }, [handleClick, interactive]);

    const patchActiveImage = useCallback((patch: (image: UGCImage) => UGCImage) => {
        if (!active) return;
        setImages((current) => current.map((image) => (image.id === active.id ? patch(image) : image)));
        setMyImages((current) => current.map((image) => (image.id === active.id ? patch(image) as UGCSubmissionImage : image)));
    }, [active, setImages, setMyImages]);

    const applyServerImage = useCallback((serverImage: UGCImageActionPatch) => {
        setImages((current) => current.map((image) => (image.id === serverImage.id ? {
            ...image,
            ...serverImage,
        } : image)));
        setMyImages((current) => current.map((image) => (image.id === serverImage.id ? {
            ...image,
            ...serverImage,
            status: (serverImage as UGCSubmissionImage).status ?? image.status,
        } : image)));
    }, [setImages, setMyImages]);

    const handleToggleUpvote = useCallback(async () => {
        if (!active || actionPending) return;
        if (!isAuthenticated) {
            openOemAuthModal('login');
            return;
        }
        const nextUpvoted = !active.upvoted;
        const delta = nextUpvoted ? 1 : -1;
        patchActiveImage((image) => ({
            ...image,
            upvoted: nextUpvoted,
            upvotes: Math.max(0, getUpvoteCount(image) + delta),
            upvoteCount: Math.max(0, getUpvoteCount(image) + delta),
        }));
        setActionPending(true);
        try {
            applyServerImage(await toggleUGCImageUpvote(active.id, nextUpvoted));
        } catch {
            patchActiveImage((image) => ({
                ...image,
                upvoted: !nextUpvoted,
                upvotes: Math.max(0, getUpvoteCount(image) - delta),
                upvoteCount: Math.max(0, getUpvoteCount(image) - delta),
            }));
        } finally {
            setActionPending(false);
        }
    }, [actionPending, active, applyServerImage, isAuthenticated, patchActiveImage, setActionPending]);

    const handleToggleFlag = useCallback(async () => {
        if (!active || actionPending || isOwnActive) return;
        if (!isAuthenticated) {
            openOemAuthModal('login');
            return;
        }
        const nextFlagged = !active.flagged;
        patchActiveImage((image) => ({
            ...image,
            flagged: nextFlagged,
            status: nextFlagged ? 'flagged' : image.status === 'flagged' ? 'active' : image.status,
        }));
        setActionPending(true);
        try {
            applyServerImage(await toggleUGCImageFlag(active.id, nextFlagged));
        } catch {
            patchActiveImage((image) => ({
                ...image,
                flagged: !nextFlagged,
                status: !nextFlagged ? 'flagged' : image.status === 'flagged' ? 'active' : image.status,
            }));
        } finally {
            setActionPending(false);
        }
    }, [actionPending, active, applyServerImage, isAuthenticated, isOwnActive, patchActiveImage, setActionPending]);

    const handleToggleRecall = useCallback(async () => {
        if (!active || actionPending || !isOwnActive) return;
        if (!isAuthenticated) {
            openOemAuthModal('login');
            return;
        }
        const nextRecallRequested = !active.recallRequested && active.status !== 'remove_request';
        patchActiveImage((image) => ({
            ...image,
            recallRequested: nextRecallRequested,
            status: nextRecallRequested ? 'remove_request' : image.status === 'remove_request' ? 'active' : image.status,
        }));
        setActionPending(true);
        try {
            applyServerImage(await toggleUGCImageRecall(active.id, nextRecallRequested));
        } catch (err) {
            if (nextRecallRequested && isActionConflict(err)) {
                patchActiveImage((image) => ({
                    ...image,
                    recallRequested: true,
                    status: 'remove_request',
                }));
                return;
            }
            patchActiveImage((image) => ({
                ...image,
                recallRequested: !nextRecallRequested,
                status: !nextRecallRequested ? 'remove_request' : image.status === 'remove_request' ? 'active' : image.status,
            }));
        } finally {
            setActionPending(false);
        }
    }, [actionPending, active, applyServerImage, isAuthenticated, isOwnActive, patchActiveImage, setActionPending]);

    if (!show) return null;

    return (
        <>
            <div
                className={classNames(styles.pointImage, {
                    [styles.noImage]: state === 'noImage',
                    [styles.pending]: state === 'pending',
                    [styles.hasImage]: state === 'hasImage',
                    [styles.isClickable]: interactive,
                    [styles.isUploading]: uploading,
                })}
                style={progressStyle}
                onClick={handleClick}
                role={interactive ? 'button' : undefined}
                tabIndex={interactive ? 0 : undefined}
                onKeyDown={handleKeyDown}
            >
                {state === 'hasImage' && active ? (
                    <img src={previewUrl} alt={active.content || pointName} />
                ) : (
                    <div className={styles.noImage}>
                        {uploading
                            ? tUI('detail.uploading')
                            : loading
                                ? ''
                                : state === 'pending'
                                    ? tUI('detail.uploadPending')
                                    : tUI('detail.noInfo')}
                        {showRules && !uploading && !loading && (
                            <div className={styles.communityRule}>
                                <span>{tUI('detail.communityRule1')}</span>
                                {' '}
                                <a
                                    href={rulesUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(event) => event.stopPropagation()}
                                >
                                    {tUI('detail.communityRule2')}
                                </a>
                            </div>
                        )}
                    </div>
                )}
            </div>
            <input
                ref={inputRef}
                className={styles.imageInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                onChange={(event) => void upload(event)}
            />
            {error && (
                <div className={styles.uploadHint}>{error}</div>
            )}
            <Viewer
                open={viewerOpen && Boolean(active)}
                imageUrl={active?.url ?? ''}
                alt={active?.content || pointName}
                authorNickname={authorNickname}
                authorPublicUid={authorPublicUid}
                createdAt={createdAt}
                upvoteCount={active ? getUpvoteCount(active) : 0}
                upvoted={Boolean(active?.upvoted)}
                flagged={Boolean(active?.flagged)}
                recallRequested={Boolean(active?.recallRequested || active?.status === 'remove_request')}
                canFlag={!isOwnActive}
                canRecall={isOwnActive}
                actionPending={actionPending}
                shareCopied={copiedPopupVisible}
                onToggleUpvote={() => void handleToggleUpvote()}
                onToggleFlag={() => void handleToggleFlag()}
                onShare={() => void copyPointShareUrl()}
                onToggleRecall={() => void handleToggleRecall()}
                onClose={() => setViewerOpen(false)}
            />
        </>
    );
});

Uploader.displayName = 'Uploader';

export default Uploader;
