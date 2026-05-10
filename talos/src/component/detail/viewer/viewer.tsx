import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './viewer.module.scss';

interface ViewerProps {
    open: boolean;
    imageUrl: string;
    alt: string;
    authorNickname?: string;
    authorPublicUid?: string;
    createdAtLabel?: string;
    onClose: () => void;
}

const Viewer: React.FC<ViewerProps> = ({
    open,
    imageUrl,
    alt,
    authorNickname,
    authorPublicUid,
    createdAtLabel,
    onClose,
}) => {
    type Phase = 'unmounted' | 'entering' | 'open' | 'exiting';
    const exitDuration = 300;
    const [phase, setPhase] = useState<Phase>(() => (open ? 'entering' : 'unmounted'));

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
                    <img src={imageUrl} alt={alt} className={styles.viewerImage} />
                </div>
                <div className={styles.viewerMetaBar}>
                    <div className={styles.viewerMetaItem}>
                        <span className={styles.viewerMetaLabel}>AUTHOR</span>
                        <span className={styles.viewerMetaValue}>{authorNickname || '--'}</span>
                    </div>
                    <div className={styles.viewerMetaItem}>
                        <span className={styles.viewerMetaLabel}>UID</span>
                        <span className={styles.viewerMetaValue}>{authorPublicUid || '--'}</span>
                    </div>
                    <div className={styles.viewerMetaItem}>
                        <span className={styles.viewerMetaLabel}>TIME</span>
                        <span className={styles.viewerMetaValue}>{createdAtLabel || '--'}</span>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
};

export default Viewer;
