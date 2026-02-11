import React, { useEffect, useState } from 'react';
import styles from './domain.module.scss';
import { useTranslateUI } from '@/locale';
import LOGGER from '@/utils/log';
import parse from 'html-react-parser';
import Button from '@/component/button/button';
import { useIsUserGuideOpen } from '@/store/uiPrefs';

const STORAGE_KEY = 'domain-prefs';
const DISMISS_DURATION_DAYS = 30;
const CN_DOMAIN = 'opendfieldmap.cn';
const ORG_DOMAIN = 'opendfieldmap.org';

interface DomainPrefs {
    dismissed: boolean;
    expiresAt: number; // timestamp
}

interface GeoIPResponse {
    country_code?: string;
}

const DomainBanner: React.FC = () => {
    const t = useTranslateUI();
    const [shouldShow, setShouldShow] = useState(false);
    const [targetDomain, setTargetDomain] = useState<'cn' | 'org' | null>(null);
    const isUserGuideOpen = useIsUserGuideOpen();
    const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

    const getStoredPrefs = (): DomainPrefs | null => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return null;
            const prefs = JSON.parse(stored) as DomainPrefs;
            // Check if expired
            if (prefs.expiresAt && Date.now() > prefs.expiresAt) {
                localStorage.removeItem(STORAGE_KEY);
                return null;
            }
            return prefs;
        } catch (err) {
            LOGGER.warn('Failed to parse domain prefs:', err);
            return null;
        }
    };

    const setStoredPrefs = (prefs: DomainPrefs) => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
        } catch (err) {
            LOGGER.warn('Failed to store domain prefs:', err);
        }
    };

    const getCurrentDomain = (): 'cn' | 'org' | 'other' => {
        const hostname = window.location.hostname;
        if (hostname.includes(CN_DOMAIN)) return 'cn';
        if (hostname.includes(ORG_DOMAIN)) return 'org';
        
        // For localhost testing: check URL parameter ?domain=cn or ?domain=org
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            const urlParams = new URLSearchParams(window.location.search);
            const testDomain = urlParams.get('domain');
            if (testDomain === 'cn') return 'cn';
            if (testDomain === 'org') return 'org';
        }
        
        return 'other';
    };

    useEffect(() => {
        const root = document.documentElement;
        const readTheme = () => {
            const attr = root.getAttribute('data-theme');
            setResolvedTheme(attr === 'dark' ? 'light' : 'dark');
        };
        readTheme();
        const observer = new MutationObserver(readTheme);
        observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (isUserGuideOpen) return;
        const checkAndShowBanner = async () => {
            // Check if already dismissed
            const prefs = getStoredPrefs();
            if (prefs?.dismissed) {
                return;
            }

            const currentDomain = getCurrentDomain();
            // Don't show banner if not on .cn or .org domain
            if (currentDomain === 'other') {
                return;
            }

            try {
                // Fetch geolocation from API
                const response = await fetch('https://api.ip.sb/geoip', {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json',
                    },
                });

                if (!response.ok) {
                    LOGGER.warn('GeoIP API request failed:', response.status);
                    return;
                }

                const data = (await response.json()) as GeoIPResponse;
                const countryCode = data.country_code;

                if (!countryCode) {
                    LOGGER.warn('No country code in GeoIP response');
                    return;
                }

                // Determine if we should show banner
                // Show .cn recommendation if user is in China (CN) and on .org domain
                // Show .org recommendation if user is not in China and on .cn domain
                const isChina = countryCode === 'CN';
                
                if (isChina && currentDomain === 'org') {
                    setTargetDomain('cn');
                    setShouldShow(true);
                } else if (!isChina && currentDomain === 'cn') {
                    setTargetDomain('org');
                    setShouldShow(true);
                }
            } catch (err) {
                LOGGER.warn('Failed to fetch geolocation:', err);
            }
        };

        void checkAndShowBanner();
    }, [isUserGuideOpen]);

    const handleClose = () => {
        setShouldShow(false);
        const expiresAt = Date.now() + DISMISS_DURATION_DAYS * 24 * 60 * 60 * 1000;
        setStoredPrefs({ dismissed: true, expiresAt });
    };

    if (isUserGuideOpen || !shouldShow || !targetDomain) {
        return null;
    }

    const getMessage = () => {
        if (targetDomain === 'cn') {
            return parse(t('domain.cn'));
        }
        return parse(t('domain.org'));
    };

    return (
        <div className={styles.bannerContainer}>
            <div className={styles.bannerWrap}>
                <div className={styles.bannerContent}>
                    <span className={styles.bannerText}>{getMessage()}</span>
                </div>
                <Button
                    text={t('common.close') || 'Close'}
                    aria-label={t('common.close') || 'Close'}
                    buttonType='close'
                    buttonStyle='icon'
                    schema={resolvedTheme}
                    size='1.2rem'
                    onClick={handleClose}
                />
            </div>
        </div>
    );
};

export default DomainBanner;
