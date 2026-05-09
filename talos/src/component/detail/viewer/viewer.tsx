import React, { useEffect } from 'react';
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
    useEffect(() => {
        if (!open) return;

        const previousOverflow = document.body.style.overflow;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', handleKeyDown);

        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [open, onClose]);

    if (!open || !imageUrl || typeof document === 'undefined') {
        return null;
    }

    return createPortal(
        <div
            className={styles.viewerOverlay}
            onClick={onClose}
            role="presentation"
        >
            <div
                className={styles.viewerPanel}
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
