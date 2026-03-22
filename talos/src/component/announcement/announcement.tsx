import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import styles from './announcement.module.scss';
import { useTranslateUI } from '@/locale';
import AnnouncementIcon from '@/assets/logos/announce.svg?react';
import Modal from '@/component/modal/modal';
import { fetchAnnouncements } from '@/utils/announcement';

export interface AnnouncementItem {
    id: string;
    title: string;
    description: string;
    content: string;
    date?: string;
}

export interface AnnouncementModalProps {
    open: boolean;
    onClose?: () => void;
    onChange?: (open: boolean) => void;
    onHasUnread?: (hasUnread: boolean) => void;
}

const AnnouncementModal: React.FC<AnnouncementModalProps> = ({ open, onClose, onChange, onHasUnread }) => {
    const t = useTranslateUI();
    const [activeIndex, setActiveIndex] = useState(0);
    const [indicatorLeft, setIndicatorLeft] = useState<number | null>(null);
    const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
    const tabBarRef = useRef<HTMLDivElement | null>(null);
    const tabRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
    const activeItem = announcements[activeIndex] ?? announcements[0];

    // Fetch announcements
    useEffect(() => {
        const loadAnnouncements = async () => {
            try {
                const data = (await fetchAnnouncements()) as AnnouncementItem[];
                setAnnouncements(data);

                // Check for unread
                const lastRead = localStorage.getItem('announcement_last_read');
                const latestDate = data[0]?.date;
                const hasUnread = !lastRead || (latestDate && new Date(latestDate) > new Date(lastRead));
                onHasUnread?.(typeof hasUnread === 'boolean' ? hasUnread : true);
            } catch (error) {
                console.error('Failed to fetch announcements:', error);
                setAnnouncements([]);
            }
        };
        void loadAnnouncements();
    }, [onHasUnread]);

    useEffect(() => {
        if (activeIndex >= announcements.length) {
            setActiveIndex(0);
        }
    }, [activeIndex, announcements.length]);

    // Mark as read when opened
    useEffect(() => {
        if (open && announcements.length > 0) {
            const latestDate = announcements[0]?.date;
            if (latestDate) {
                localStorage.setItem('announcement_last_read', latestDate);
                onHasUnread?.(false);
            }
        }
    }, [open, announcements, onHasUnread]);

    // Update triangle indicator position when active tab changes
    useEffect(() => {
        const activeBtn = tabRefs.current.get(activeIndex);
        const bar = tabBarRef.current;
        if (!activeBtn || !bar) return;
        const btnRect = activeBtn.getBoundingClientRect();
        const barRect = bar.getBoundingClientRect();
        setIndicatorLeft(btnRect.left - barRect.left + btnRect.width / 2);
    }, [activeIndex, open, announcements.length]);

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
                        <div className={styles.tabBarWrapper}>
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
                            {announcements.length > 1 && indicatorLeft !== null && (
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

export default React.memo(AnnouncementModal);
