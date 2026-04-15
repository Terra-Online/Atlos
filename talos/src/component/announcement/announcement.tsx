import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import styles from './announcement.module.scss';
import { useTranslateUI } from '@/locale';
import AnnouncementIcon from '@/assets/logos/announce.svg?react';
import Modal from '@/component/modal/modal';
import { getAnnouncementDebugMode } from '@/utils/announcement';

export interface AnnItem {
    id: string;
    title: string;
    description: string;
    content: string;
    date?: string;
}

export interface AnnModalProps {
    open: boolean;
    onClose?: () => void;
    onChange?: (open: boolean) => void;
    onHasUnread?: (hasUnread: boolean) => void;
    announcements?: AnnItem[];
}

const AnnModal: React.FC<AnnModalProps> = ({ open, onClose, onChange, onHasUnread, announcements: passedAnnouncements = [] }) => {
    const t = useTranslateUI();
    const [activeIndex, setActiveIndex] = useState(0);
    const [indicatorLeft, setIndicatorLeft] = useState<number | null>(null);
    const announcements = passedAnnouncements;
    const tabBarWrapperRef = useRef<HTMLDivElement | null>(null);
    const tabBarRef = useRef<HTMLDivElement | null>(null);
    const tabRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
    const activeItem = announcements[activeIndex] ?? announcements[0];
    const isForceUnreadDebug = getAnnouncementDebugMode() === 'force-unread';

    const updateIndicator = useCallback(() => {
        const activeTab = tabRefs.current.get(activeIndex);
        const wrapper = tabBarWrapperRef.current;
        if (!activeTab || !wrapper) {
            setIndicatorLeft(null);
            return;
        }

        const tabRect = activeTab.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();
        const centerX = tabRect.left - wrapperRect.left + tabRect.width / 2;
        setIndicatorLeft(centerX);
    }, [activeIndex]);

    useEffect(() => {
        if (activeIndex >= announcements.length) {
            setActiveIndex(0);
        }
    }, [activeIndex, announcements.length]);

    useEffect(() => {
        if (!open || announcements.length === 0) {
            setIndicatorLeft(null);
            return;
        }

        const tabBar = tabBarRef.current;
        if (!tabBar) return;

        const rafId = requestAnimationFrame(updateIndicator);
        const handleResize = () => updateIndicator();
        const handleScroll = () => updateIndicator();

        window.addEventListener('resize', handleResize);
        tabBar.addEventListener('scroll', handleScroll, { passive: true });

        const resizeObserver = new ResizeObserver(() => updateIndicator());
        resizeObserver.observe(tabBar);

        const activeTab = tabRefs.current.get(activeIndex);
        if (activeTab) {
            resizeObserver.observe(activeTab);
        }

        return () => {
            cancelAnimationFrame(rafId);
            window.removeEventListener('resize', handleResize);
            tabBar.removeEventListener('scroll', handleScroll);
            resizeObserver.disconnect();
        };
    }, [activeIndex, announcements.length, open, updateIndicator]);

    // Mark as read when opened
    useEffect(() => {
        if (open && announcements.length > 0 && !isForceUnreadDebug) {
            const latestDate = announcements[0]?.date;
            if (latestDate) {
                localStorage.setItem('announcement_last_read', latestDate);
                onHasUnread?.(false);
            }
        }
    }, [open, announcements, onHasUnread, isForceUnreadDebug]);

    const handleClose = () => {
        onClose?.();
        onChange?.(false);
    };

    return (
        <Modal
            open={open}
            onClose={handleClose}
            onChange={onChange}
            title={t('announcement.title')}
            icon={<AnnouncementIcon aria-hidden="true" />}
            iconScale={0.8}
            size='full'
            keepMounted={true}
        >
            <div className={styles.body}>
                {announcements.length === 0 ? (
                    <div className={styles.emptyState}>
                        <p>{t('announcement.empty') || 'No announcements available'}</p>
                    </div>
                ) : (
                    <>
                        <div className={styles.tabBarWrapper} ref={tabBarWrapperRef}>
                            <div className={styles.tabBar} role='tablist' ref={tabBarRef}>
                                {announcements.map((item, index) => (
                                    <button
                                        key={item.id}
                                        role='tab'
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

                        <div className={styles.description}>{activeItem?.description}</div>

                        <div className={styles.content} role='tabpanel'>
                            <ReactMarkdown>{activeItem?.content || ''}</ReactMarkdown>
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
};

export default React.memo(AnnModal);
