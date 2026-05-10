import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './viewer.module.scss';
import PopoverTooltip from '@/component/popover/popover';
import { useTranslateUI } from '@/locale';
import { formatDateTimeYYYYMMDDHHMMSS, formatElapsedShort, parseDateLike } from '@/utils/timeFormat';

interface ViewerProps {
    open: boolean;
    imageUrl: string;
    alt: string;
    authorNickname?: string;
    authorPublicUid?: string;
    createdAt?: string;
    onClose: () => void;
}

const Viewer: React.FC<ViewerProps> = ({
    open,
    imageUrl,
    alt,
    authorNickname,
    authorPublicUid,
    createdAt,
    onClose,
}) => {
    type Phase = 'unmounted' | 'entering' | 'open' | 'exiting';
    const exitDuration = 300;
    const [phase, setPhase] = useState<Phase>(() => (open ? 'entering' : 'unmounted'));
    const [imageLoaded, setImageLoaded] = useState(false);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const tUI = useTranslateUI();

    const authorLabel = String(tUI('detail.viewer.author') || 'AUTHOR');
    const uploadedAtLabel = String(tUI('detail.viewer.uploadedAt') || 'Uploaded At');
    const agoLabel = String(tUI('idcard.ago') || 'Ago');
    const createdAtDate = useMemo(() => parseDateLike(createdAt), [createdAt]);
    const createdAtLabel = createdAtDate ? formatDateTimeYYYYMMDDHHMMSS(createdAtDate) : '';
    const createdAtAgo = createdAtDate
        ? `${formatElapsedShort(createdAtDate.getTime(), nowMs)} ${agoLabel}`
        : '';

    useEffect(() => {
        setImageLoaded(false);
    }, [imageUrl]);

    useEffect(() => {
        if (!open || !createdAtDate) return undefined;
        setNowMs(Date.now());
        const timer = window.setInterval(() => {
            setNowMs(Date.now());
        }, 1000);
        return () => window.clearInterval(timer);
    }, [open, createdAtDate]);

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
                <div className={styles.viewerContent}>
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
                            <span className={styles.viewerMetaLabel}>{authorLabel}</span>
                            <span className={styles.viewerMetaDivider}>|</span>
                            <span className={styles.viewerAuthorName}>{authorNickname || '--'}</span>
                        </div>
                        <div className={styles.viewerMetaRow}>
                            <span className={styles.viewerMetaLabel}>OEM ID</span>
                            <span className={styles.viewerMetaDivider}>|</span>
                            <span className={styles.viewerAuthorId}>{authorPublicUid || '--'}</span>
                        </div>
                    </div>
                    <PopoverTooltip content={createdAtAgo} placement="top" disabled={!createdAtAgo}>
                        <div
                            className={styles.viewerTime}
                            aria-label={`${uploadedAtLabel} ${createdAtLabel || '--'}${createdAtAgo ? ` (${createdAtAgo})` : ''}`}
                        >
                            {uploadedAtLabel} {createdAtLabel || '--'}
                        </div>
                    </PopoverTooltip>
                </div>
            </div>
        </div>,
        document.body,
    );
};

export default Viewer;
