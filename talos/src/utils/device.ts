import { useState, useEffect, useCallback } from 'react';
import { getAppViewport, subscribeAppViewport } from '@/component/scale/pip';

export type DeviceType = 'mobile' | 'tablet' | 'desktop';

interface UseDeviceResult {
    type: DeviceType;
    isMobile: boolean;
    isTablet: boolean;
    isDesktop: boolean;
    isPictureInPicture: boolean;
    width: number;
    height: number;
}

export function useDevice(
    mobileBP: number = 768,
    tabletBP: number = 1024
): UseDeviceResult {
    const getDeviceType = useCallback((): DeviceType => {
        if (typeof window === 'undefined') return 'desktop'; // SSR fallback
        const viewport = getAppViewport();
        const width = viewport.width;
        const effectiveMobileBP = viewport.inPictureInPicture ? viewport.mobileBreakpoint : mobileBP;
        if (width <= effectiveMobileBP) return 'mobile';
        if (width <= tabletBP) return 'tablet';
        return 'desktop';
    }, [mobileBP, tabletBP]);

    const [deviceType, setDeviceType] = useState<DeviceType>(getDeviceType);

    useEffect(() => {
        const handleResize = () => setDeviceType(getDeviceType());
        handleResize();
        window.addEventListener('resize', handleResize);
        const unsubscribeViewport = subscribeAppViewport(() => {
            handleResize();
        });
        return () => {
            window.removeEventListener('resize', handleResize);
            unsubscribeViewport();
        };
    }, [getDeviceType]);

    const viewport = getAppViewport();

    return {
        type: deviceType,
        isMobile: deviceType === 'mobile',
        isTablet: deviceType === 'tablet',
        isDesktop: deviceType === 'desktop',
        isPictureInPicture: viewport.inPictureInPicture,
        width: viewport.width,
        height: viewport.height,
    };
}
