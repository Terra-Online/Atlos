import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './viewer.module.scss';
import PopoverTooltip from '@/component/popover/popover';
import { useTranslateUI } from '@/locale';
import { formatDateTimeYYYYMMDDHHMMSS, formatElapsedShort, parseDateLike } from '@/utils/timeFormat';
import UpvoteIcon from '@/assets/images/UI/upvote.svg?react';
import FlagIcon from '@/assets/images/UI/flag.svg?react';
import ShareIcon from '@/assets/images/UI/share.svg?react';
import RecallIcon from '@/assets/images/UI/recall.svg?react';

interface ViewerProps {
    open: boolean;
    imageUrl: string;
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
    actionPending?: boolean;
    shareCopied?: boolean;
    onToggleUpvote?: () => void;
    onToggleFlag?: () => void;
    onShare?: () => void;
    onToggleRecall?: () => void;
    onClose: () => void;
}

const Viewer: React.FC<ViewerProps> = ({
    open,
    imageUrl,
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
    actionPending = false,
    shareCopied = false,
    onToggleUpvote,
    onToggleFlag,
    onShare,
    onToggleRecall,
    onClose,
}) => {
    type Phase = 'unmounted' | 'entering' | 'open' | 'exiting';
    const exitDuration = 300;
    const [phase, setPhase] = useState<Phase>(() => (open ? 'entering' : 'unmounted'));
    const [imageLoaded, setImageLoaded] = useState(false);
    const [createdAtAgo, setCreatedAtAgo] = useState('');
    const tUI = useTranslateUI();

    const createdAtDate = useMemo(() => parseDateLike(createdAt), [createdAt]);
    const createdAtLabel = createdAtDate ? formatDateTimeYYYYMMDDHHMMSS(createdAtDate) : '';
    const refreshCreatedAtAgo = useCallback(() => {
        setCreatedAtAgo(createdAtDate
            ? `${formatElapsedShort(createdAtDate.getTime(), Date.now())} ${tUI('idcard.ago')}`
            : '');
    }, [createdAtDate, tUI]);
    const flagLabel = flagged ? tUI('detail.viewer.unflag') : tUI('detail.viewer.flag');
    const recallLabel = recallRequested ? tUI('detail.viewer.unrecall') : tUI('detail.viewer.recall');

    useEffect(() => {
        setImageLoaded(false);
    }, [imageUrl]);

    useEffect(() => {
        setCreatedAtAgo('');
    }, [createdAt]);

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

    if (phase === 'unmounted' || !imageUrl || typeof document === 'undefined') {
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
                aria-label={alt}
            >
                <div 
                    className={styles.viewerContent}
                    style={{ '--bg': `url(${imageUrl})` } as React.CSSProperties}>
                    {!imageLoaded && (
                        <div className={styles.viewerSkeleton} aria-hidden="true" />
                    )}
                    <img
                        src={imageUrl}
                        alt={alt}
                        className={styles.viewerImage}
                        data-loaded={imageLoaded ? 'true' : 'false'}
                        onLoad={() => setImageLoaded(true)}
                    />
                </div>
                <div className={styles.viewerMetaBar}>
                    <div className={styles.viewerAuthorBlock}>
                        <div className={styles.viewerMetaRow}>
                            <span className={styles.viewerMetaLabel}>{tUI('detail.viewer.author')}</span>
                            <span className={styles.viewerMetaDivider}>|</span>
                            <span className={styles.viewerAuthorName}>{authorNickname || '--'}</span>
                        </div>
                        <div className={styles.viewerMetaRow}>
                            <span className={styles.viewerMetaLabel}>OEM ID</span>
                            <span className={styles.viewerMetaDivider}>|</span>
                            <span className={styles.viewerAuthorId}>{authorPublicUid || '--'}</span>
                        </div>
                    </div>
                    <div className={styles.viewerActions}>
                        <PopoverTooltip content={tUI('detail.viewer.upvote')} placement="top" gap={4}>
                            <button
                                type="button"
                                className={styles.viewerActionButton}
                                data-active={upvoted ? 'true' : 'false'}
                                disabled={actionPending || !onToggleUpvote}
                                onClick={onToggleUpvote}
                                aria-pressed={upvoted}
                                aria-label='Upvote'
                            >
                                <UpvoteIcon />
                                <span className={styles.viewerUpvoteCount}>{upvoteCount}</span>
                            </button>
                        </PopoverTooltip>
                        <span className={styles.viewerActionDivider} aria-hidden="true"></span>
                        {canFlag && (
                            <PopoverTooltip content={flagLabel} placement="top" gap={4}>
                                <button
                                    type="button"
                                    className={styles.viewerActionButton}
                                    data-active={flagged ? 'true' : 'false'}
                                    disabled={actionPending || !onToggleFlag}
                                    onClick={onToggleFlag}
                                    aria-pressed={flagged}
                                    aria-label='Flag'
                                >
                                    <FlagIcon />
                                </button>
                            </PopoverTooltip>
                        )}
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
                        {canRecall && (
                            <>
                                <span className={styles.viewerActionDivider} aria-hidden="true"></span>
                                <PopoverTooltip content={recallLabel} placement="top" gap={4}>
                                    <button
                                        type="button"
                                        className={styles.viewerActionButton}
                                        data-active={recallRequested ? 'true' : 'false'}
                                        disabled={actionPending || !onToggleRecall}
                                        onClick={onToggleRecall}
                                        aria-pressed={recallRequested}
                                        aria-label='Recall'
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
