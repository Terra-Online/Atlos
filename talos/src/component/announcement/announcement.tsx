import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import ReactMarkdown from 'react-markdown';
import styles from './announcement.module.scss';
import { useTranslateUI } from '@/locale';
import { MOCK_ANNOUNCEMENTS } from './mockData';
import AnnouncementIcon from '../../assets/logos/announcement.svg?react';
import Button from '@/component/button/button';

export interface AnnouncementModalProps {
    open: boolean;
    onClose?: () => void;
    onChange?: (open: boolean) => void;
}

type Phase = 'unmounted' | 'entering' | 'open' | 'exiting';

const EXIT_DURATION = 300;

const AnnouncementModal: React.FC<AnnouncementModalProps> = ({ open, onClose, onChange }) => {
    const t = useTranslateUI();
    const [phase, setPhase] = useState<Phase>(() => (open ? 'entering' : 'unmounted'));
    const [activeIndex, setActiveIndex] = useState(0);
    const [indicatorLeft, setIndicatorLeft] = useState<number | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const tabBarRef = useRef<HTMLDivElement | null>(null);
    const tabRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
    const prevActiveRef = useRef<HTMLElement | null>(null);
    // TODO: use request
    const announcements = MOCK_ANNOUNCEMENTS;
    const activeItem = announcements[activeIndex] ?? announcements[0];

    // Phase lifecycle: unmounted → entering → open → exiting → unmounted
    useEffect(() => {
        if (open) {
            if (phase === 'unmounted' || phase === 'exiting') {
                setPhase('entering');
            }
        } else {
            if (phase === 'open') {
                setPhase('exiting');
            } else if (phase === 'entering') {
                setPhase('unmounted');
            }
        }
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    // entering → open on next frame
    useEffect(() => {
        if (phase === 'entering') {
            const raf = requestAnimationFrame(() => setPhase('open'));
            return () => cancelAnimationFrame(raf);
        }
        return undefined;
    }, [phase]);

    // exiting → unmounted after CSS animation completes
    useEffect(() => {
        if (phase === 'exiting') {
            const timer = window.setTimeout(() => setPhase('unmounted'), EXIT_DURATION);
            return () => clearTimeout(timer);
        }
        return undefined;
    }, [phase]);

    useEffect(() => {
        onChange?.(open);
    }, [open, onChange]);

    // Focus management
    useEffect(() => {
        if (open) {
            prevActiveRef.current = document.activeElement as HTMLElement | null;
            requestAnimationFrame(() => panelRef.current?.focus());
        } else if (prevActiveRef.current) {
            prevActiveRef.current.focus?.();
        }
    }, [open]);

    // ESC key to close
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose?.();
                onChange?.(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose, onChange]);

    const handleClose = useCallback(() => {
        onClose?.();
        onChange?.(false);
    }, [onClose, onChange]);

    const handleMaskClick = useCallback(() => {
        handleClose();
    }, [handleClose]);

    // Update triangle indicator position when active tab changes
    useEffect(() => {
        const activeBtn = tabRefs.current.get(activeIndex);
        const bar = tabBarRef.current;
        if (!activeBtn || !bar) return;
        const btnRect = activeBtn.getBoundingClientRect();
        const barRect = bar.getBoundingClientRect();
        setIndicatorLeft(btnRect.left - barRect.left + btnRect.width / 2);
    }, [activeIndex, phase]);

    if (typeof document === 'undefined' || phase === 'unmounted') return null;

    const state = phase === 'open' ? 'open' : 'closed';

    return ReactDOM.createPortal(
        <div
            className={styles.mask}
            data-state={state}
            onClick={handleMaskClick}
        >
            <div
                className={styles.panel}
                data-state={state}
                role="dialog"
                aria-modal="true"
                aria-label={t('announcement.title')}
                tabIndex={-1}
                ref={panelRef}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className={styles.header}>
                    <span className={styles.headerIcon}>
                        <AnnouncementIcon aria-hidden="true" />
                    </span>
                    <span className={styles.headerTitle}>{t('announcement.title')}</span>
                    <Button
                        text={t('common.close')}
                        aria-label={t('common.close') || 'Close'}
                        buttonType="close"
                        onClick={handleClose}
                    />
                </div>

                {/* Tab Bar */}
                <div className={styles.tabBarWrapper}>
                    <div className={styles.tabBar} role="tablist" ref={tabBarRef}>
                        {announcements.map((item, index) => (
                            <button
                                key={item.id}
                                role="tab"
                                aria-selected={activeIndex === index}
                                ref={(el) => {
                                    if (el) tabRefs.current.set(index, el);
                                    else tabRefs.current.delete(index);
                                }}
                                className={`${styles.tab} ${activeIndex === index ? styles.activeTab : ''}`}
                                onClick={() => setActiveIndex(index)}
                            >
                                {item.title}
                            </button>
                        ))}
                    </div>
                    {indicatorLeft !== null && (
                        <div
                            className={styles.tabIndicator}
                            style={{ left: `${indicatorLeft}px` }}
                        />
                    )}
                </div>

                {/* Description Bar */}
                <div className={styles.description}>{activeItem.description}</div>

                {/* Markdown Content */}
                <div className={styles.content} role="tabpanel">
                    <ReactMarkdown>{activeItem.content}</ReactMarkdown>
                </div>
            </div>
        </div>,
        document.body,
    );
};

export default React.memo(AnnouncementModal);
