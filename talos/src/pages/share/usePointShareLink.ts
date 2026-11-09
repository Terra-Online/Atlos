import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { IMarkerData } from '@/data/marker';
import { generatePointShareUrl } from '@/services/routing';
import { copyTextToClipboard } from '@/platform/clipboard';
import type { MarkerNavigationOptions } from '@/services/map/navigation';

const COPY_POPUP_DURATION_MS = 1500;

export const usePointShareLink = (
    point: Pick<IMarkerData, 'id' | 'type' | 'subregId'> | null | undefined,
    options: MarkerNavigationOptions = {},
) => {
    const [copiedPopupVisible, setCopiedPopupVisible] = useState(false);
    const copyPopupTimerRef = useRef<number | null>(null);
    const frameRef = useRef<number | null>(null);
    const mountedRef = useRef(false);
    const requestRef = useRef(0);

    const pointShareUrl = useMemo(
        () => {
            if (!point) return '';
            return generatePointShareUrl(point, { content: options.content });
        },
        [options.content, point],
    );

    useLayoutEffect(() => {
        mountedRef.current = true;
        requestRef.current += 1;
        setCopiedPopupVisible(false);
        return () => {
            mountedRef.current = false;
            requestRef.current += 1;
            if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
            if (copyPopupTimerRef.current !== null) {
                window.clearTimeout(copyPopupTimerRef.current);
            }
            copyPopupTimerRef.current = null;
        };
    }, [pointShareUrl]);

    const copyPointShareUrl = useCallback(async () => {
        if (!pointShareUrl || typeof window === 'undefined') return false;

        const request = ++requestRef.current;
        const copied = await copyTextToClipboard(pointShareUrl);
        if (!copied) return false;
        // The clipboard operation may still succeed after navigation. Its toast
        // belongs only to the point/content that initiated this request.
        if (!mountedRef.current || requestRef.current !== request) return true;

        setCopiedPopupVisible(false);
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            setCopiedPopupVisible(true);
        });
        if (copyPopupTimerRef.current !== null) {
            window.clearTimeout(copyPopupTimerRef.current);
        }
        copyPopupTimerRef.current = window.setTimeout(() => {
            setCopiedPopupVisible(false);
        }, COPY_POPUP_DURATION_MS);
        return true;
    }, [pointShareUrl]);

    return {
        copiedPopupVisible,
        copyPointShareUrl,
        pointShareUrl,
    };
};
