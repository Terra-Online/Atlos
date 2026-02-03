import React from 'react';
import styles from './notice.module.scss';
import { useTranslateUI } from '@/locale';
import parse from 'html-react-parser';

const Notice: React.FC = () => {
    const t = useTranslateUI();
    
    return (
        <div className={styles.noticeContainer}>
            <div className={styles.noticeBody}>
                {parse(t('notice.uptodate'))}
            </div>
        </div>
    );
};

export default Notice;
