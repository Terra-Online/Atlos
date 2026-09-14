import { useCallback, useEffect, useState } from 'react';
import {
    getAppDocument,
    getAppViewport,
    subscribePictureInPictureState,
} from '@/component/scale/pip';
import { isApplePlatform } from '@/platform/platform';
import { useAppViewport } from '@/platform/device';

const isUIVisibilityShortcut = (event: KeyboardEvent): boolean => {
    if (event.key.toLowerCase() !== 'h' || event.altKey || event.shiftKey) return false;
    return isApplePlatform() ? event.metaKey : event.ctrlKey;
};

export const useUIVisibility = () => {
    const viewport = useAppViewport();
    const [uiVisible, setUiVisible] = useState(true);
    const [shortcutDocument, setShortcutDocument] = useState<Document>(getAppDocument);
    const toggleUI = useCallback(() => {
        if (viewport.isPipUiTooSmall) return;
        setUiVisible((visible) => !visible);
    }, [viewport.isPipUiTooSmall]);
    const showUI = useCallback(() => {
        if (viewport.isPipUiTooSmall) return;
        setUiVisible(true);
    }, [viewport.isPipUiTooSmall]);

    useEffect(() => {
        let activeDocument: Document | null = null;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (!isUIVisibilityShortcut(event)) return;
            event.preventDefault();
            event.stopPropagation();
            toggleUI();
        };

        const bindShortcut = () => {
            activeDocument?.removeEventListener('keydown', handleKeyDown, true);
            activeDocument = getAppDocument();
            activeDocument.addEventListener('keydown', handleKeyDown, true);
            setShortcutDocument(activeDocument);
        };

        bindShortcut();
        const unsubscribePictureInPicture = subscribePictureInPictureState(bindShortcut);

        return () => {
            unsubscribePictureInPicture();
            activeDocument?.removeEventListener('keydown', handleKeyDown, true);
        };
    }, [toggleUI]);

    useEffect(() => {
        const handlePictureInPictureState = (active: boolean) => {
            if (!active) {
                setUiVisible(true);
                return;
            }

            setUiVisible(!getAppViewport().isPipCompact);
        };

        const unsubscribePictureInPicture = subscribePictureInPictureState(handlePictureInPictureState);

        return () => {
            unsubscribePictureInPicture();
        };
    }, []);

    useEffect(() => {
        if (viewport.isPipCompact) setUiVisible(false);
    }, [viewport.isPipCompact]);

    return {
        shortcutDocument,
        showVisibilityControl: !viewport.isPipUiTooSmall,
        showUI,
        uiVisible,
        toggleUI,
    };
};
