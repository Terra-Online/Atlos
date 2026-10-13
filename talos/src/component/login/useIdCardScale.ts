import { type RefObject, useEffect, useRef, useState } from 'react';

const FALLBACK_CARD_WIDTH_PX = 336;

export const useIdCardScale = (cardRef: RefObject<HTMLDivElement | null>) => {
    const shellRef = useRef<HTMLDivElement | null>(null);
    const [scale, setScale] = useState(1);

    useEffect(() => {
        const shell = shellRef.current;
        if (!shell) return;

        const updateScale = () => {
            const width =
                cardRef.current?.offsetWidth ?? FALLBACK_CARD_WIDTH_PX;
            if (!width) return;
            const next = Math.min(1, shell.clientWidth / width);
            setScale((previous) =>
                Math.abs(previous - next) < 0.001 ? previous : next,
            );
        };

        updateScale();
        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', updateScale);
            return () => window.removeEventListener('resize', updateScale);
        }

        const observer = new ResizeObserver(updateScale);
        observer.observe(shell);
        if (cardRef.current) observer.observe(cardRef.current);
        return () => observer.disconnect();
    }, [cardRef]);

    return { shellRef, scale };
};
