import React, { useEffect, useRef, useState } from 'react';
import Banner from '@/component/banner/banner';
import { useTranslateUI } from '@/locale';
import { useLocatorStore } from './state';

const LocatorBanner: React.FC = () => {
    const t = useTranslateUI();
    const bannerKey = useLocatorStore((state) => state.bannerKey);
    const clearBanner = useLocatorStore((state) => state.clearBanner);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

    useEffect(() => {
        if (!bannerKey) return undefined;

        const onPointerDown = (event: PointerEvent) => {
            if (rootRef.current?.contains(event.target as Node)) return;
            clearBanner();
        };

        window.addEventListener('pointerdown', onPointerDown, true);
        return () => {
            window.removeEventListener('pointerdown', onPointerDown, true);
        };
    }, [bannerKey, clearBanner]);

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

    if (!bannerKey) return null;

    return (
        <div ref={rootRef}>
            <Banner
                content={t(bannerKey)}
                onClose={clearBanner}
                schema={resolvedTheme}
            />
        </div>
    );
};

export default LocatorBanner;
