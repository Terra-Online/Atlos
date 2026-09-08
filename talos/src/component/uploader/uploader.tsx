import React, { memo, useCallback, useEffect, useMemo, type CSSProperties } from 'react';
import classNames from 'classnames';
import styles from './uploader.module.scss';
import Viewer from '../detail/viewer/viewer';
import { useTranslateUI } from '@/locale';
import type { IMarkerData } from '@/data/marker';
import { usePointShareLink } from '@/utils/shareLink';
import { Shortcut, type KeyChip } from '@/component/shortcut';
import { modKey } from '@/component/settings/shortcuts';
import { linkTpl } from '@/utils/docsLink';
import Carousel from '@/component/carousel';
import ShortActions, { type ShortActionItem } from './shortActions';
import LikeIcon from '@/assets/images/UI/like.svg?react';
import FlagIcon from '@/assets/images/UI/flag.svg?react';
import RecallIcon from '@/assets/images/UI/recall.svg?react';
import useUGCPointImages, { isPublic } from './useUGCPointImages';
import useUGCUpload from './useUGCUpload';
import useUGCImageActions from './useUGCImageActions';
import useImageUiState from './useImageUiState';
import useUploadInteraction from './useUploadInteraction';
import useCarousel from './useCarousel';

type Props = {
    point: IMarkerData;
    pointName: string;
    active?: boolean;
};

const UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,.heic,.heif';
const UPLOAD_KEY_SCALE = 0.75;
const UPLOAD_CLICK_KEYS: KeyChip[] = [{ label: '', type: 'left-click', size: '1u' }];

const Uploader = memo(({ point, pointName, active: activeDetail = true }: Props) => {
    const tUI = useTranslateUI();

    const imageState = useUGCPointImages(point);
    const uploadState = useUGCUpload(point, imageState);
    const actionsState = useUGCImageActions(imageState, uploadState);
    const uiState = useImageUiState(imageState, uploadState);
    const interaction = useUploadInteraction(point, uploadState, activeDetail, actionsState.viewerOpen);
    const carousel = useCarousel();

    const { active, activeImages, selectedImageId, setSelectedImageId, show, loading, shouldOpenViewer, acknowledgeViewerOpen } = imageState;
    const {
        uploading,
        uploadSent,
        progress,
        error,
        lastSubmission,
        inputRef,
        upload,
        requestUpload,
        requestAppendUpload,
        canAppendUpload,
    } = uploadState;
    const {
        actionPending,
        recallConfirming,
        cancelRecallConfirmation,
        viewerOpen,
        setViewerOpen,
        handleToggleUpvote,
        handleToggleFlag,
        handleToggleRecall,
    } = actionsState;
    const {
        state, canPreview, interactive, showRules, rulesUrl,
        authorNickname, authorPublicUid, createdAt,
        upvoteCount, upvoted, flagged, recallRequested,
        isOwnActive, canFlag, canRecall, recallOnly,
    } = uiState;
    const { dragActive, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = interaction;
    const {
        carouselHoverDirection,
        handleCarouselLayerClick,
        handleCarouselLayerPointerMove,
        handleCarouselLayerPointerLeave,
        handleCarouselLayerKeyDown,
    } = carousel;

    const { copiedPopupVisible, copyPointShareUrl } = usePointShareLink(point, {
        content: active && isPublic(active) ? { kind: 'image', id: active.id } : undefined,
    });

    useEffect(() => {
        if (!shouldOpenViewer || !active || active.id !== selectedImageId) return;
        setViewerOpen(true);
        acknowledgeViewerOpen();
    }, [acknowledgeViewerOpen, active, selectedImageId, setViewerOpen, shouldOpenViewer]);

    const progressStyle = useMemo(
        () => ({ '--uploader-progress': `${Math.round(progress * 100)}%` }) as CSSProperties,
        [progress],
    );
    const uploadPasteKeys = useMemo<KeyChip[]>(
        () => [{ label: modKey(), variant: 'mod' }, { label: 'V' }],
        [],
    );
    const uploadShortcutHint = useMemo(() => {
        const text = tUI('detail.noInfo');
        const parts = text.split(/(\{paste\}|\{click\})/g).filter(Boolean);

        return parts.map((part, index) => {
            if (part === '{paste}') {
                return <Shortcut key={`${part}:${index}`} keys={uploadPasteKeys} scale={UPLOAD_KEY_SCALE} />;
            }
            if (part === '{click}') {
                return <Shortcut key={`${part}:${index}`} keys={UPLOAD_CLICK_KEYS} scale={UPLOAD_KEY_SCALE} />;
            }
            return <span key={`${part}:${index}`}>{part}</span>;
        });
    }, [tUI, uploadPasteKeys]);
    const communityRule = useMemo(() => (
        linkTpl(
            tUI('detail.communityRule'),
            rulesUrl,
            (event) => event.stopPropagation(),
        )
    ), [rulesUrl, tUI]);
    const shortActionLabels = useMemo(() => ({
        upvote: tUI('detail.viewer.upvote'),
        flag: tUI('detail.viewer.flag'),
        upload: tUI('detail.viewer.uploadAno'),
    }), [tUI]);
    const detailShortActions = useMemo<ShortActionItem[]>(() => {
        if (!active) return [];

        const actions: ShortActionItem[] = [
            {
                id: 'upvote',
                label: shortActionLabels.upvote,
                icon: <LikeIcon />,
                active: upvoted,
                disabled: recallOnly,
                onClick: () => void handleToggleUpvote(),
            },
        ];

        if (!isOwnActive) {
            actions.push({
                id: 'flag',
                label: flagged ? tUI('detail.viewer.unflag') : shortActionLabels.flag,
                icon: <FlagIcon />,
                active: flagged,
                disabled: !canFlag,
                tooltipKey: `flag:${flagged ? 'on' : 'off'}`,
                onClick: () => void handleToggleFlag(),
            });
        }

        actions.push(
            {
                id: 'upload',
                label: shortActionLabels.upload,
                icon: <RecallIcon />,
                iconClassName: styles.previewShortActionRecallIcon,
                disabled: !canAppendUpload,
                onClick: requestAppendUpload,
            },
        );

        return actions;
    }, [
        active,
        canAppendUpload,
        canFlag,
        flagged,
        handleToggleFlag,
        handleToggleUpvote,
        isOwnActive,
        recallOnly,
        requestAppendUpload,
        shortActionLabels,
        tUI,
        upvoted,
    ]);

    const handleClick = useCallback(() => {
        if (canPreview) {
            setViewerOpen(true);
            return;
        }
        requestUpload();
    }, [canPreview, requestUpload, setViewerOpen]);

    const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget) return;
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
                    [styles.isDragActive]: dragActive,
                    [styles.isUploading]: uploading,
                })}
                style={progressStyle}
                onClick={handleClick}
                role={interactive ? 'button' : undefined}
                tabIndex={interactive ? 0 : undefined}
                onKeyDown={handleKeyDown}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                {active ? (
                    <Carousel
                        items={activeImages}
                        selectedKey={selectedImageId}
                        getKey={(image) => image.id}
                        onSelectedKeyChange={setSelectedImageId}
                    >
                        {({ item, hasMultiple, previous, next }) => item && (
                            <>
                                <img src={item.url} alt={item.content || pointName} />
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
                                <ShortActions
                                    className={styles.previewShortActions}
                                    items={detailShortActions}
                                />
                                {state === 'pending' && (
                                    <div className={styles.noImage}>
                                        {tUI('detail.uploadPending')}
                                    </div>
                                )}
                            </>
                        )}
                    </Carousel>
                ) : (
                    <div className={styles.noImage}>
                        {uploading && !uploadSent && !lastSubmission
                            ? tUI('detail.uploading')
                            : loading
                                ? ''
                                : state === 'pending'
                                    ? tUI('detail.uploadPending')
                                    : (
                                        <span className={styles.uploadShortcutHint}>
                                            {uploadShortcutHint}
                                        </span>
                                    )}
                        {showRules && !uploading && !loading && (
                            <div className={styles.communityRule}>
                                {communityRule}
                            </div>
                        )}
                    </div>
                )}
            </div>
            <input
                ref={inputRef}
                className={styles.imageInput}
                type="file"
                accept={UPLOAD_ACCEPT}
                onChange={(event) => void upload(event)}
            />
            {error && (
                <div className={styles.uploadHint}>{error}</div>
            )}
            <Viewer
                open={viewerOpen && Boolean(active)}
                images={activeImages}
                selectedImageId={selectedImageId}
                onSelectedImageIdChange={setSelectedImageId}
                imageUrl={active?.url ?? ''}
                alt={active?.content || pointName}
                authorNickname={authorNickname}
                authorPublicUid={authorPublicUid}
                createdAt={createdAt}
                upvoteCount={upvoteCount}
                upvoted={upvoted}
                flagged={flagged}
                recallRequested={recallRequested}
                canFlag={canFlag}
                canRecall={canRecall}
                recallOnly={recallOnly}
                actionPending={actionPending}
                recallConfirming={recallConfirming}
                onRecallBlur={cancelRecallConfirmation}
                shareCopied={copiedPopupVisible}
                onToggleUpvote={() => void handleToggleUpvote()}
                onToggleFlag={() => void handleToggleFlag()}
                onShare={() => void copyPointShareUrl()}
                onToggleRecall={() => void handleToggleRecall()}
                canAppendUpload={canAppendUpload}
                onRequestUpload={requestAppendUpload}
                uploading={uploading}
                onClose={() => setViewerOpen(false)}
            />
        </>
    );
});

Uploader.displayName = 'Uploader';

export default Uploader;
