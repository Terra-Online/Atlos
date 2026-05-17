import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IMarkerData } from '@/data/marker';
import { generatePointShareUrl } from '@/utils/urlState';

const COPY_POPUP_DURATION_MS = 1500;

export const copyTextToClipboard = async (text: string): Promise<boolean> => {
    if (!text || typeof navigator === 'undefined' || !navigator.clipboard) {
        return false;
    }

    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
};

export const usePointShareLink = (point: Pick<IMarkerData, 'id' | 'type' | 'subregId'> | null | undefined) => {
    const [copiedPopupVisible, setCopiedPopupVisible] = useState(false);
    const copyPopupTimerRef = useRef<number | null>(null);

    const pointShareUrl = useMemo(
        () => (point ? generatePointShareUrl(point) : ''),
        [point],
    );

    useEffect(() => {
        return () => {
            if (copyPopupTimerRef.current !== null) {
                window.clearTimeout(copyPopupTimerRef.current);
            }
        };
    }, []);

    const copyPointShareUrl = useCallback(async () => {
        if (!pointShareUrl || typeof window === 'undefined') return false;

        const copied = await copyTextToClipboard(pointShareUrl);
        if (!copied) return false;

        setCopiedPopupVisible(false);
        requestAnimationFrame(() => {
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
