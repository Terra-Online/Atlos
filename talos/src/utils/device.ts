import { useState, useEffect, useCallback } from 'react';

export type DeviceType = 'mobile' | 'tablet' | 'desktop';

interface UseDeviceResult {
    type: DeviceType;
    isMobile: boolean;
    isTablet: boolean;
    isDesktop: boolean;
}

export function useDevice(
    mobileBP: number = 768,
    tabletBP: number = 1024
): UseDeviceResult {
    const getDeviceType = useCallback((): DeviceType => {
        if (typeof window === 'undefined') return 'desktop'; // SSR fallback
        const width = window.innerWidth;
        if (width <= mobileBP) return 'mobile';
        if (width <= tabletBP) return 'tablet';
        return 'desktop';
    }, [mobileBP, tabletBP]);

    const [deviceType, setDeviceType] = useState<DeviceType>(getDeviceType);

    useEffect(() => {
        const handleResize = () => setDeviceType(getDeviceType());
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [getDeviceType]);

    return {
        type: deviceType,
        isMobile: deviceType === 'mobile',
        isTablet: deviceType === 'tablet',
        isDesktop: deviceType === 'desktop',
    };
}