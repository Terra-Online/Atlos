import { useEffect, useState } from 'react';
import {
    getAppDocument,
    getAppViewport,
    subscribeAppViewport,
    subscribePictureInPictureState,
} from '@/component/scale/pip';
import type { AppViewport } from '@/component/scale/pipViewport';

export const MOBILE_BREAKPOINT = 768;
export const TABLET_BREAKPOINT = 1024;
export const DESKTOPER_BREAKPOINT = 1920;
export const DESKTOPEST_BREAKPOINT = 2560;

export type DeviceType = 'mobile' | 'tablet' | 'desktop' | 'desktoper' | 'desktopest';

interface UseDeviceResult {
    type: DeviceType;
    isMobile: boolean;
    isTablet: boolean;
    isDesktop: boolean;
    isDesktoper: boolean;
    isDesktopest: boolean;
    isPictureInPicture: boolean;
    width: number;
    height: number;
}

export const useAppViewport = (): AppViewport => {
    const [viewport, setViewport] = useState<AppViewport>(() => getAppViewport());

    useEffect(() => {
        let observedWindow: Window | null = null;

        const sync = () => {
            setViewport(getAppViewport());
        };

        const bindWindow = () => {
            observedWindow?.removeEventListener('resize', sync);
            observedWindow = getAppDocument().defaultView;
            observedWindow?.addEventListener('resize', sync);
            sync();
        };

        const unsubscribeViewport = subscribeAppViewport(sync);
        const unsubscribePictureInPicture = subscribePictureInPictureState(bindWindow);
        bindWindow();

        return () => {
            unsubscribeViewport();
            unsubscribePictureInPicture();
            observedWindow?.removeEventListener('resize', sync);
        };
    }, []);

    return viewport;
};

export function useDevice(
    mobileBP: number = MOBILE_BREAKPOINT,
    tabletBP: number = TABLET_BREAKPOINT,
    desktoperBP: number = DESKTOPER_BREAKPOINT,
    desktopestBP: number = DESKTOPEST_BREAKPOINT,
): UseDeviceResult {
    const viewport = useAppViewport();
    const deviceType = getDeviceType(viewport, mobileBP, tabletBP, desktoperBP, desktopestBP);

    return {
        type: deviceType,
        isMobile: deviceType === 'mobile',
        isTablet: deviceType === 'tablet',
        isDesktop: deviceType === 'desktop' || deviceType === 'desktoper' || deviceType === 'desktopest',
        isDesktoper: deviceType === 'desktoper' || deviceType === 'desktopest',
        isDesktopest: deviceType === 'desktopest',
        isPictureInPicture: viewport.inPictureInPicture,
        width: viewport.width,
        height: viewport.height,
    };
}

const getDeviceType = (
    viewport: AppViewport,
    mobileBP: number,
    tabletBP: number,
    desktoperBP: number,
    desktopestBP: number,
): DeviceType => {
    if (viewport.inPictureInPicture ? viewport.isPipMobile : viewport.width <= mobileBP) return 'mobile';
    if (viewport.width <= tabletBP) return 'tablet';
    if (viewport.width >= desktopestBP) return 'desktopest';
    if (viewport.width >= desktoperBP) return 'desktoper';
    return 'desktop';
};
