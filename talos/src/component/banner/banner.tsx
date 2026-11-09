import { usePresence } from '@/lib/dom/usePresence';
import { useAppDocument } from '@/platform/pictureInPicture';
import React, { useEffect, useRef, useState } from 'react';
import styles from './banner.module.scss';
import Button from '@/component/button/button';
import { useTranslateUI } from '@/locale';

const BANNER_EXIT_DURATION_MS = 200;

interface BannerProps {
    content: React.ReactNode;
    onClose: () => void;
    schema?: 'light' | 'dark';
    open?: boolean;
}

const Banner: React.FC<BannerProps> = ({ content, onClose, schema = 'light', open = true }) => {
    const t = useTranslateUI();
    const ownerDocument = useAppDocument();
    const [dismissed, setDismissed] = useState(false);
    const [renderedContent, setRenderedContent] = useState(content);
    const closeRequested = useRef(false);
    const { present, phase } = usePresence({
        open: open && !dismissed,
        ownerDocument,
        exitDuration: BANNER_EXIT_DURATION_MS,
        onAfterClose: () => {
            if (closeRequested.current) {
                closeRequested.current = false;
                onClose();
            }
        },
    });
    const closing = phase === 'exiting';
    useEffect(() => {
        if (!open) return;
        closeRequested.current = false;
        setRenderedContent(content);
        setDismissed(false);
    }, [open, content]);

    if (!present) return null;

    return (
        <div
            className={styles.bannerContainer}
            data-state={phase === 'open' ? 'open' : 'closed'}
            data-closing={closing || undefined}
        >
            <div className={styles.bannerWrap}>
                <div className={styles.bannerContent}>
                    <span className={styles.bannerText}>{renderedContent}</span>
                </div>
                <Button
                    text={t('common.close')}
                    aria-label={t('common.close')}
                    buttonType='close'
                    buttonStyle='icon'
                    schema={schema}
                    size='1.2rem'
                    onClick={() => { closeRequested.current = true; setDismissed(true); }}
                />
            </div>
        </div>
    );
};

export default Banner;
