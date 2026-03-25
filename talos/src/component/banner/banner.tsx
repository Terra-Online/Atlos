import React from 'react';
import styles from './banner.module.scss';
import Button from '@/component/button/button';
import { useTranslateUI } from '@/locale';

interface BannerProps {
    content: React.ReactNode;
    onClose: () => void;
    schema?: 'light' | 'dark';
}

const Banner: React.FC<BannerProps> = ({ content, onClose, schema = 'light' }) => {
    const t = useTranslateUI();

    return (
        <div className={styles.bannerContainer}>
            <div className={styles.bannerWrap}>
                <div className={styles.bannerContent}>
                    <span className={styles.bannerText}>{content}</span>
                </div>
                <Button
                    text={t('common.close') || 'Close'}
                    aria-label={t('common.close') || 'Close'}
                    buttonType='close'
                    buttonStyle='icon'
                    schema={schema}
                    size='1.2rem'
                    onClick={onClose}
                />
            </div>
        </div>
    );
};

export default Banner;