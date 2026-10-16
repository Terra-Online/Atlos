import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import PopoverTooltip from './popover';

type OverflowPopoverTextProps = {
    text: string;
    className?: string;
    id?: string;
    element?: 'div' | 'span';
    placement?: 'top' | 'bottom' | 'left' | 'right';
    gap?: number;
};

const isTextOverflowing = (element: HTMLElement): boolean => (
    element.scrollWidth > element.clientWidth + 1
);

const OverflowPopoverText = ({
    text,
    className,
    id,
    element = 'span',
    placement = 'top',
    gap = 6,
}: OverflowPopoverTextProps) => {
    const textRef = useRef<HTMLElement | null>(null);
    const [overflowing, setOverflowing] = useState(false);

    const measure = useCallback(() => {
        const elementNode = textRef.current;
        setOverflowing(elementNode ? isTextOverflowing(elementNode) : false);
    }, []);

    useLayoutEffect(() => {
        measure();
    }, [measure, text]);

    useEffect(() => {
        const elementNode = textRef.current;
        if (!elementNode) return undefined;

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', measure);
            return () => window.removeEventListener('resize', measure);
        }

        const observer = new ResizeObserver(measure);
        observer.observe(elementNode);
        return () => observer.disconnect();
    }, [measure]);

    useEffect(() => {
        let disposed = false;
        const doc = textRef.current?.ownerDocument || document;
        const onFontRegionChange = (event: Event) => {
            // Prepared faces are registered after load(), so FontFaceSet.ready
            // alone does not announce the later regional activation.
            const owner = event.target as HTMLElement | null;
            if (owner?.contains(textRef.current)) measure();
        };
        doc.addEventListener('fontregionchange', onFontRegionChange);
        void doc.fonts?.ready.then(() => {
            if (!disposed) measure();
        });

        return () => {
            disposed = true;
            doc.removeEventListener('fontregionchange', onFontRegionChange);
        };
    }, [measure, text]);

    const child = element === 'div'
        ? (
            <div id={id} className={className} ref={textRef as React.Ref<HTMLDivElement>}>
                {text}
            </div>
        )
        : (
            <span id={id} className={className} ref={textRef as React.Ref<HTMLSpanElement>}>
                {text}
            </span>
        );

    return (
        <PopoverTooltip content={text} placement={placement} gap={gap} disabled={!overflowing}>
            {child}
        </PopoverTooltip>
    );
};

export default OverflowPopoverText;
