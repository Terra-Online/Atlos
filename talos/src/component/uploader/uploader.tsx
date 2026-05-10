import React, { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import classNames from 'classnames';
import styles from './uploader.module.scss';
import Viewer from '../detail/viewer/viewer';
import { getAnnouncementLocaleKey } from '@/utils/announcement';
import { openOemAuthModal } from '@/component/login/authEvents';
import { useAuthStore } from '@/store/auth';
import { useLocale, useTranslateUI } from '@/locale';
import type { IMarkerData } from '@/data/marker';
import {
    getUGCImageTransformedUrl,
    listUGCImages,
    listUGCMyImages,
    resolveUGCUploadTarget,
    uploadUGCImage,
    UGCClientError,
    type UGCImage,
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

const fmtDate = (value: string | undefined, locale: string): string => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    try {
        return new Intl.DateTimeFormat(locale, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        }).format(date);
    } catch {
        return date.toISOString().replace('T', ' ').slice(0, 19);
    }
};

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

    const tr = useCallback((key: string, fallback: string): string => {
        const value = tUI(`detail.${key}`);
        return typeof value === 'string' && value ? value : fallback;
    }, [tUI]);

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
    const active = pointImages[0] ?? ownPublic;
    const previewUrl = useMemo(
        () => (active ? getUGCImageTransformedUrl(active.url, { width: 400 }) : ''),
        [active],
    );
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
        tr,
        upload,
        uploading,
        viewerOpen,
        createdAtLabel: fmtDate(active?.createdAt, locale),
    };
};

const Uploader = memo(({ point, pointName }: Props) => {
    const {
        active,
        authorNickname,
        authorPublicUid,
        canPreview,
        createdAtLabel,
        error,
        inputRef,
        interactive,
        loading,
        previewUrl,
        progress,
        requestUpload,
        rulesUrl,
        setViewerOpen,
        show,
        showRules,
        state,
        tr,
        upload,
        uploading,
        viewerOpen,
    } = useUpload(point);
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
                            ? tr('uploading', 'Uploading...')
                            : loading
                                ? ''
                                : state === 'pending'
                                    ? tr('uploadPending', 'Upload received. Waiting for review.')
                                    : tr('uploadCta', 'No info. Click to upload.')}
                        {showRules && !uploading && !loading && (
                            <div className={styles.communityRule}>
                                <span>{tr('communityRule1', 'By uploading, you confirm you have read')}</span>
                                {' '}
                                <a
                                    href={rulesUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(event) => event.stopPropagation()}
                                >
                                    {tr('communityRule2', 'Community Guidelines')}
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
                createdAtLabel={createdAtLabel}
                onClose={() => setViewerOpen(false)}
            />
        </>
    );
});

Uploader.displayName = 'Uploader';

export default Uploader;
