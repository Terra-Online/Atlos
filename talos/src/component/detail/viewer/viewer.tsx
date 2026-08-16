import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './viewer.module.scss';
import PopoverTooltip from '@/component/popover/popover';
import { useLocale, useTranslateUI } from '@/locale';
import { formatAbsoluteTime, formatRelativeTime, parseTimestamp } from '@/lib/format/time';
import UpvoteIcon from '@/assets/images/UI/upvote.svg?react';
import FlagIcon from '@/assets/images/UI/flag.svg?react';
import ShareIcon from '@/assets/images/UI/share.svg?react';
import RecallIcon from '@/assets/images/UI/recall.svg?react';
import Carousel from '@/component/carousel';
import type { UGCImage } from '@/services/ugc/client';
import ShortActions, { type ShortActionItem } from '@/component/uploader/shortActions';

type CarouselDirection = 'previous' | 'next';

const getViewerUpvoteCount = (image: UGCImage): number => (
    Number.isFinite(image.upvotes)
        ? Math.max(0, image.upvotes as number)
        : Number.isFinite(image.upvoteCount)
            ? Math.max(0, image.upvoteCount as number)
            : 0
);

const getCarouselDirection = (
    rect: DOMRect,
    clientX: number,
    clientY: number,
    controlWidthRatio: number,
    controlHeightRatio: number,
    offsetRatio: number,
): CarouselDirection | null => {
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const controlWidth = rect.width * controlWidthRatio;
    const controlHeight = controlWidth * controlHeightRatio;
    const offset = rect.width * offsetRatio;
    const top = (rect.height - controlHeight) / 2;
    const bottom = top + controlHeight;

    if (y < top || y > bottom) return null;
    if (x >= offset && x <= offset + controlWidth) return 'previous';
    if (x >= rect.width - offset - controlWidth && x <= rect.width - offset) return 'next';
    return null;
};

interface ViewerProps {
    open: boolean;
    imageUrl: string;
    images?: UGCImage[];
    selectedImageId?: string | null;
    alt: string;
    authorNickname?: string;
    authorPublicUid?: string;
    createdAt?: string;
    upvoteCount?: number;
    upvoted?: boolean;
    flagged?: boolean;
    recallRequested?: boolean;
    canFlag?: boolean;
    canRecall?: boolean;
    recallOnly?: boolean;
    actionPending?: boolean;
    recallConfirming?: boolean;
    shareCopied?: boolean;
    onToggleUpvote?: () => void;
    onToggleFlag?: () => void;
    onShare?: () => void;
    onToggleRecall?: () => void;
    onRecallBlur?: () => void;
    onSelectedImageIdChange?: (imageId: string) => void;
    canAppendUpload?: boolean;
    onRequestUpload?: () => void;
    uploading?: boolean;
    onClose: () => void;
}

const Viewer: React.FC<ViewerProps> = ({
    open,
    imageUrl,
    images,
    selectedImageId,
    alt,
    authorNickname,
    authorPublicUid,
    createdAt,
    upvoteCount = 0,
    upvoted = false,
    flagged = false,
    recallRequested = false,
    canFlag = true,
    canRecall = false,
    recallOnly = false,
    actionPending = false,
    recallConfirming = false,
    shareCopied = false,
    onToggleUpvote,
    onToggleFlag,
    onShare,
    onToggleRecall,
    onRecallBlur,
    onSelectedImageIdChange,
    canAppendUpload = false,
    onRequestUpload,
    uploading = false,
    onClose,
}) => {
    type Phase = 'unmounted' | 'entering' | 'open' | 'exiting';
    const exitDuration = 300;
    const [phase, setPhase] = useState<Phase>(() => (open ? 'entering' : 'unmounted'));
    const [imageLoaded, setImageLoaded] = useState(false);
    const [createdAtAgo, setCreatedAtAgo] = useState('');
    const [carouselHoverDirection, setCarouselHoverDirection] = useState<CarouselDirection | null>(null);
    const tUI = useTranslateUI();
    const locale = useLocale();
    const carouselImages = useMemo(
        () => images?.length ? images : [],
        [images],
    );
    const selectedImage = useMemo(
        () => carouselImages.find((image) => image.id === selectedImageId) ?? carouselImages[0] ?? null,
        [carouselImages, selectedImageId],
    );
    const currentImageUrl = selectedImage?.url ?? imageUrl;
    const currentAlt = selectedImage?.content || alt;
    const currentAuthorNickname = selectedImage?.author?.nickname ?? authorNickname;
    const currentAuthorPublicUid = selectedImage?.author?.publicUid ?? authorPublicUid;
    const currentCreatedAt = selectedImage?.createdAt ?? createdAt;
    const currentUpvoteCount = selectedImage ? getViewerUpvoteCount(selectedImage) : upvoteCount;
    const currentUpvoted = selectedImage ? Boolean(selectedImage.upvoted) : upvoted;
    const currentFlagged = selectedImage ? Boolean(selectedImage.flagged) : flagged;
    const currentRecallRequested = selectedImage
        ? Boolean(selectedImage.recallRequested || selectedImage.status === 'remove_request')
        : recallRequested;

    const createdAtDate = useMemo(() => parseTimestamp(currentCreatedAt), [currentCreatedAt]);
    const createdAtLabel = createdAtDate
        ? formatAbsoluteTime(createdAtDate, { locale, precision: 'dateTime' })
        : '';
    const refreshCreatedAtAgo = useCallback(() => {
        setCreatedAtAgo(createdAtDate
            ? formatRelativeTime(createdAtDate, { locale })
            : '');
    }, [createdAtDate, locale]);
    const flagLabel = currentFlagged ? tUI('detail.viewer.unflag') : tUI('detail.viewer.flag');
    const recallLabel = recallConfirming
        ? tUI('common.confirmAgain')
        : currentRecallRequested ? tUI('detail.viewer.unrecall') : tUI('detail.viewer.recall');
    const uploadLabel = tUI('detail.viewer.uploadAno');
    const viewerShortActions = useMemo<ShortActionItem[]>(() => (
        [{
            id: 'upload',
            label: uploadLabel,
            icon: <RecallIcon />,
            iconClassName: styles.viewerShortActionUploadIcon,
            disabled: !canAppendUpload,
            active: uploading,
            onClick: onRequestUpload,
        }]
    ), [canAppendUpload, onRequestUpload, uploadLabel, uploading]);

    const handleCarouselLayerClick = useCallback((
        event: React.MouseEvent<HTMLDivElement>,
        previous: () => void,
        next: () => void,
    ) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const direction = getCarouselDirection(rect, event.clientX, event.clientY, 0.04, 1.5879, 0.025);

        if (direction === 'previous') {
            previous();
            return;
        }

        if (direction === 'next') {
            next();
        }
    }, []);

    const handleCarouselLayerPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const direction = getCarouselDirection(
            event.currentTarget.getBoundingClientRect(),
            event.clientX,
            event.clientY,
            0.04,
            1.5879,
            0.025,
        );
        setCarouselHoverDirection(direction);
    }, []);

    const handleCarouselLayerPointerLeave = useCallback(() => {
        setCarouselHoverDirection(null);
    }, []);

    const handleCarouselLayerKeyDown = useCallback((
        event: React.KeyboardEvent<HTMLDivElement>,
        previous: () => void,
        next: () => void,
    ) => {
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            previous();
            return;
        }

        if (event.key === 'ArrowRight') {
            event.preventDefault();
            next();
        }
    }, []);

    useEffect(() => {
        setImageLoaded(false);
    }, [currentImageUrl]);

    useEffect(() => {
        setCreatedAtAgo('');
    }, [currentCreatedAt]);

    useEffect(() => {
        if (open) {
            if (phase === 'unmounted' || phase === 'exiting') {
                setPhase('entering');
            }
        } else if (phase === 'open') {
            setPhase('exiting');
        } else if (phase === 'entering') {
            setPhase('unmounted');
        }
    }, [open, phase]);

    useEffect(() => {
        if (phase !== 'entering') return undefined;
        const raf = requestAnimationFrame(() => {
            setPhase('open');
        });
        return () => cancelAnimationFrame(raf);
    }, [phase]);

    useEffect(() => {
        if (phase !== 'exiting') return undefined;
        const timer = window.setTimeout(() => {
            setPhase('unmounted');
        }, exitDuration);
        return () => window.clearTimeout(timer);
    }, [phase]);

    useEffect(() => {
        if (phase === 'unmounted') return undefined;

        const previousOverflow = document.body.style.overflow;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && phase === 'open') {
                onClose();
            }
        };

        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', handleKeyDown);

        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [phase, onClose]);

    if (phase === 'unmounted' || !currentImageUrl || typeof document === 'undefined') {
        return null;
    }

    const state = phase === 'open' ? 'open' : 'closed';

    return createPortal(
        <div
            className={styles.viewerOverlay}
            data-state={state}
            onClick={onClose}
            role="presentation"
        >
            <div
                className={styles.viewerPanel}
                data-state={state}
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={currentAlt}
            >
                <Carousel
                    items={carouselImages}
                    selectedKey={selectedImageId}
                    getKey={(image) => image.id}
                    onSelectedKeyChange={onSelectedImageIdChange}
                >
                    {({ item, hasMultiple, previous, next }) => {
                        const visibleImageUrl = item?.url ?? currentImageUrl;
                        const visibleAlt = item?.content || currentAlt;
                        return (
                            <div
                                className={styles.viewerContent}
                                style={{ '--bg': `url(${visibleImageUrl})` } as React.CSSProperties}
                            >
                                {!imageLoaded && (
                                    <div className={styles.viewerSkeleton} aria-hidden="true" />
                                )}
                                <ShortActions className={styles.viewerShortActions} items={viewerShortActions} />
                                <img
                                    src={visibleImageUrl}
                                    alt={visibleAlt}
                                    className={styles.viewerImage}
                                    data-loaded={imageLoaded ? 'true' : 'false'}
                                    onLoad={() => setImageLoaded(true)}
	                                />
	                                {hasMultiple && (
	                                    <div
	                                        className={styles.carouselLayer}
	                                        data-hover={carouselHoverDirection ?? undefined}
	                                        role="button"
	                                        tabIndex={-1}
	                                        aria-label="Switch image"
	                                        onClick={(event) => handleCarouselLayerClick(event, previous, next)}
	                                        onKeyDown={(event) => handleCarouselLayerKeyDown(event, previous, next)}
	                                        onPointerMove={handleCarouselLayerPointerMove}
	                                        onPointerLeave={handleCarouselLayerPointerLeave}
	                                    />
	                                )}
	                            </div>
                        );
                    }}
                </Carousel>
                <div className={styles.viewerMetaBar}>
                    <div className={styles.viewerAuthorBlock}>
                        <div className={styles.viewerMetaRow}>
                            <span className={styles.viewerMetaLabel}>{tUI('detail.viewer.author')}</span>
                            <span className={styles.viewerMetaDivider}>|</span>
                            <span className={styles.viewerAuthorName}>{currentAuthorNickname || '--'}</span>
                        </div>
                        <div className={styles.viewerMetaRow}>
                            <span className={styles.viewerMetaLabel}>OEM ID</span>
                            <span className={styles.viewerMetaDivider}>|</span>
                            <span className={styles.viewerAuthorId}>{currentAuthorPublicUid || '--'}</span>
                        </div>
                    </div>
                    <div className={styles.viewerActions}>
                        {!recallOnly && (
                            <>
                                <PopoverTooltip content={tUI('detail.viewer.upvote')} placement="top" gap={4}>
                                    <button
                                        type="button"
                                        className={styles.viewerActionButton}
                                        data-active={currentUpvoted ? 'true' : 'false'}
                                        disabled={!onToggleUpvote}
                                        onClick={onToggleUpvote}
                                        aria-pressed={currentUpvoted}
                                        aria-label='Upvote'
                                    >
                                        <UpvoteIcon />
                                        <span className={styles.viewerUpvoteCount}>{currentUpvoteCount}</span>
                                    </button>
                                </PopoverTooltip>
                                <span className={styles.viewerActionDivider} aria-hidden="true"></span>
                            </>
                        )}
                        {!recallOnly && canFlag && (
                            <PopoverTooltip key={`flag:${currentFlagged ? 'on' : 'off'}`} content={flagLabel} placement="top" gap={4}>
                                <button
                                    type="button"
                                    className={styles.viewerActionButton}
                                    data-active={currentFlagged ? 'true' : 'false'}
                                    disabled={!onToggleFlag}
                                    onClick={onToggleFlag}
                                    aria-pressed={currentFlagged}
                                    aria-label='Flag'
                                >
                                    <FlagIcon />
                                </button>
                            </PopoverTooltip>
                        )}
                        {!recallOnly && (
                            <PopoverTooltip
                                content={shareCopied ? tUI('detail.copied') : tUI('detail.viewer.share')}
                                placement="top"
                                gap={4}
                                visible={shareCopied ? true : undefined}
                            >
                                <button
                                    type="button"
                                    className={styles.viewerActionButton}
                                    disabled={!onShare}
                                    onClick={onShare}
                                    aria-label='Share'
                                >
                                    <ShareIcon />
                                </button>
                            </PopoverTooltip>
                        )}
                        {canRecall && (
                            <>
                                {!recallOnly && <span className={styles.viewerActionDivider} aria-hidden="true"></span>}
                                <PopoverTooltip
                                    key={`recall:${recallConfirming ? 'confirm' : 'idle'}`}
                                    content={recallLabel}
                                    placement="top"
                                    gap={4}
                                >
                                    <button
                                        type="button"
                                        className={styles.viewerActionButton}
                                        data-action="recall"
                                        data-active={currentRecallRequested ? 'true' : 'false'}
                                        data-confirming={recallConfirming ? 'true' : 'false'}
                                        disabled={actionPending || !onToggleRecall}
                                        onClick={onToggleRecall}
                                        onBlur={onRecallBlur}
                                        aria-pressed={currentRecallRequested}
                                        aria-label={recallLabel}
                                    >
                                        <RecallIcon />
                                    </button>
                                </PopoverTooltip>
                            </>
                        )}
                    </div>
                    <PopoverTooltip content={<span>{createdAtAgo}</span>} placement="top" disabled={!createdAtDate}>
                        <div
                            className={styles.viewerTime}
                            aria-label={`${tUI('detail.viewer.uploadedAt')} ${createdAtLabel || '--'}${createdAtAgo ? ` (${createdAtAgo})` : ''}`}
                            onPointerEnter={refreshCreatedAtAgo}
                            onFocus={refreshCreatedAtAgo}
                        >
                            <span className={styles.viewerTimeLabel}>{tUI('detail.viewer.uploadedAt')}</span><span className={styles.viewerTimeValue}>{createdAtLabel || '--'}</span>
                        </div>
                    </PopoverTooltip>
                </div>
            </div>
        </div>,
        document.body,
    );
};

export default Viewer;
