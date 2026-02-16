import React, { useEffect, useState } from 'react';
import SupportModal from '@/component/support/support';
import { useIsUserGuideOpen } from '@/store/uiPrefs';
import LOGGER from '@/utils/log';
import { SUPPORT_CONFIG } from './supportConfig';

interface SupportPopupPrefs {
    viewedVersions: string[];
}

// 将纯函数移到组件外部，避免作为依赖项
const getStoredPrefs = (): SupportPopupPrefs => {
    try {
        const stored = localStorage.getItem(SUPPORT_CONFIG.storageKey);
        if (!stored) return { viewedVersions: [] };
        return JSON.parse(stored) as SupportPopupPrefs;
    } catch (err) {
        LOGGER.warn('Failed to parse support popup prefs:', err instanceof Error ? err.message : String(err));
        return { viewedVersions: [] };
    }
};

const setStoredPrefs = (prefs: SupportPopupPrefs) => {
    try {
        localStorage.setItem(SUPPORT_CONFIG.storageKey, JSON.stringify(prefs));
    } catch (err) {
        LOGGER.warn('Failed to store support popup prefs:', err instanceof Error ? err.message : String(err));
    }
};

const SupportAutoPopup: React.FC = () => {
    const [showPopup, setShowPopup] = useState(false);
    const isUserGuideOpen = useIsUserGuideOpen();

    const markCurrentVersionAsViewed = () => {
        const prefs = getStoredPrefs();
        if (!prefs.viewedVersions.includes(SUPPORT_CONFIG.version)) {
            prefs.viewedVersions.push(SUPPORT_CONFIG.version);
            setStoredPrefs(prefs);
        }
    };

    useEffect(() => {
        // 不在用户引导期间显示
        if (isUserGuideOpen) return;

        // 检查是否已查看当前版本
        const hasViewedCurrentVersion = (): boolean => {
            const prefs = getStoredPrefs();
            return prefs.viewedVersions.includes(SUPPORT_CONFIG.version);
        };

        if (!hasViewedCurrentVersion()) {
            // 延迟显示，避免与其他弹窗冲突
            const timer = setTimeout(() => {
                setShowPopup(true);
            }, SUPPORT_CONFIG.delayMs);

            return () => clearTimeout(timer);
        }
        
        return undefined;
    }, [isUserGuideOpen]);

    const handleClose = () => {
        setShowPopup(false);
        markCurrentVersionAsViewed();
        LOGGER.info(`Support popup version ${SUPPORT_CONFIG.version} marked as viewed`);
    };

    return (
        <SupportModal
            open={showPopup}
            onClose={handleClose}
        />
    );
};

export default SupportAutoPopup;
