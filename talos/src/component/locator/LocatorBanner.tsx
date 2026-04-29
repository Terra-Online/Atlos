import React, { useEffect, useRef } from 'react';
import Banner from '@/component/banner/banner';
import { useLocatorStore } from './state';

const LocatorBanner: React.FC = () => {
    const message = useLocatorStore((state) => state.bannerMessage);
    const clearBanner = useLocatorStore((state) => state.clearBanner);
    const rootRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!message) return undefined;

        const onPointerDown = (event: PointerEvent) => {
            if (rootRef.current?.contains(event.target as Node)) return;
            clearBanner();
        };

        window.addEventListener('pointerdown', onPointerDown, true);
        return () => {
            window.removeEventListener('pointerdown', onPointerDown, true);
        };
    }, [clearBanner, message]);

    if (!message) return null;

    return (
        <div ref={rootRef}>
            <Banner
                content={message}
                onClose={clearBanner}
            />
        </div>
    );
};

export default LocatorBanner;
