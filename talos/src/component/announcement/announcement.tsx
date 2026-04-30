import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import styles from './announcement.module.scss';
import { useTranslateUI } from '@/locale';
import AnnouncementIcon from '@/assets/logos/announce.svg?react';
import Modal from '@/component/modal/modal';
<<<<<<< feat/locator-sync
import { TabView } from '@/component/tabView';
import {
    getAnnouncementDebugMode,
    setAnnouncementLastRead,
=======
import {
    ANNOUNCEMENT_LAST_READ_DATE_KEY,
    ANNOUNCEMENT_LAST_READ_ID_KEY,
    getAnnouncementDebugMode,
>>>>>>> main
} from '@/utils/announcement';

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
    const announcements = passedAnnouncements;
    const activeItem = announcements[activeIndex] ?? announcements[0];
    const isForceUnreadDebug = getAnnouncementDebugMode() === 'force-unread';
    const activeKey = activeItem?.id ?? announcements[0]?.id ?? '';

    useEffect(() => {
        if (activeIndex >= announcements.length) {
            setActiveIndex(0);
        }
    }, [activeIndex, announcements.length]);

    // Mark as read when opened
    useEffect(() => {
        if (open && announcements.length > 0 && !isForceUnreadDebug) {
            const latestId = announcements[0]?.id;
            const latestDate = announcements[0]?.date;
<<<<<<< feat/locator-sync
            setAnnouncementLastRead({ id: latestId, date: latestDate });
=======
            if (latestId) {
                localStorage.setItem(ANNOUNCEMENT_LAST_READ_ID_KEY, latestId);
            }
            if (latestDate) {
                localStorage.setItem(ANNOUNCEMENT_LAST_READ_DATE_KEY, latestDate);
            }
>>>>>>> main
            onHasUnread?.(false);
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
                        <TabView
                            items={announcements.map((item) => ({
                                key: item.id,
                                label: item.title,
                                description: item.description,
                            }))}
                            activeKey={activeKey}
                            onChange={(key) => {
                                const nextIndex = announcements.findIndex((item) => item.id === key);
                                if (nextIndex >= 0) setActiveIndex(nextIndex);
                            }}
                        />

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
