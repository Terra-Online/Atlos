import { useLayoutEffect, useState } from 'react';

export const useSelectionVisibility = (selecting: boolean, fadeMs: number) => {
    const [visible, setVisible] = useState(false);
    const [fading, setFading] = useState(false);
    useLayoutEffect(() => {
        if (selecting) {
            setVisible(true);
            setFading(false);
            return;
        }
        if (!visible) return;
        setFading(false);
        const frame = requestAnimationFrame(() => setFading(true));
        const timer = window.setTimeout(() => setVisible(false), fadeMs);
        return () => {
            cancelAnimationFrame(frame);
            clearTimeout(timer);
        };
    }, [selecting, visible, fadeMs]);
    return { visible, fading };
};
