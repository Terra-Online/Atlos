import { useEffect } from 'react';
import { useLocale, useTranslateUI } from '@/locale';

export const MetaHelper = () => {
    const locale = useLocale();
    const t = useTranslateUI();

    useEffect(() => {
        document.documentElement.lang = locale;
    }, [locale]);

    useEffect(() => {
        const title = t('meta.title') || 'Open Endfield Map';
        const description = t('meta.description') || 'Open Endfield Map is an open-source online map for Arknights: Endfield.';
        
        document.title = title;
        
        // Helper to set meta content
        const setMeta = (selector: string, content: string) => {
            let el = document.querySelector(selector);
            // Some tags like og:title might be property instead of name
            if (!el) {
                 // Try to create only for standard name tags if missing
                 if (selector.includes('[name=')) {
                     el = document.createElement('meta');
                     const name = selector.match(/name="([^"]+)"/)?.[1];
                     if(name) {
                         el.setAttribute('name', name);
                         document.head.appendChild(el);
                     }
                 }
            }
            if (el) el.setAttribute('content', content);
        };

        setMeta('meta[name="description"]', description);
        setMeta('meta[property="og:title"]', title);
        setMeta('meta[property="og:description"]', description);
        setMeta('meta[name="twitter:title"]', title);
        setMeta('meta[name="twitter:description"]', description);

    }, [t, locale]);

    return null;
};