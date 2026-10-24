import React, { useCallback, useState } from 'react';

type CarouselDirection = 'previous' | 'next';

export type CarouselInteraction = {
    carouselHoverDirection: CarouselDirection | null;
    handleCarouselLayerClick: (
        event: React.MouseEvent<HTMLDivElement>,
        previous: () => void,
        next: () => void,
    ) => void;
    handleCarouselLayerPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
    handleCarouselLayerPointerLeave: () => void;
    handleCarouselLayerKeyDown: (
        event: React.KeyboardEvent<HTMLDivElement>,
        previous: () => void,
        next: () => void,
    ) => void;
};

const CONTROL_WIDTH_RATIO = 0.087;
const CONTROL_HEIGHT_RATIO = 1.5879;
const OFFSET_RATIO = 0.052;

const getCarouselDirection = (
    rect: DOMRect,
    clientX: number,
    clientY: number,
): CarouselDirection | null => {
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const controlWidth = rect.width * CONTROL_WIDTH_RATIO;
    const controlHeight = controlWidth * CONTROL_HEIGHT_RATIO;
    const offset = rect.width * OFFSET_RATIO;
    const top = (rect.height - controlHeight) / 2;
    const bottom = top + controlHeight;

    if (y < top || y > bottom) return null;
    if (x >= offset && x <= offset + controlWidth) return 'previous';
    if (x >= rect.width - offset - controlWidth && x <= rect.width - offset) return 'next';
    return null;
};

const useCarousel = (): CarouselInteraction => {
    const [carouselHoverDirection, setCarouselHoverDirection] = useState<CarouselDirection | null>(null);

    const handleCarouselLayerClick = useCallback((
        event: React.MouseEvent<HTMLDivElement>,
        previous: () => void,
        next: () => void,
    ) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const direction = getCarouselDirection(rect, event.clientX, event.clientY);

        if (direction === 'previous') {
            event.stopPropagation();
            previous();
            return;
        }

        if (direction === 'next') {
            event.stopPropagation();
            next();
        }
    }, []);

    const handleCarouselLayerPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const direction = getCarouselDirection(
            event.currentTarget.getBoundingClientRect(),
            event.clientX,
            event.clientY,
        );
        setCarouselHoverDirection(direction);
    }, []);

    const handleCarouselLayerPointerLeave = useCallback(() => {
        setCarouselHoverDirection(null);
    }, []);

    const handleCarouselLayerKeyDown = useCallback((
        event: React.KeyboardEvent<HTMLDivElement>,
        previous: () => void,
        next: () => void,
    ) => {
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            event.stopPropagation();
            previous();
            return;
        }

        if (event.key === 'ArrowRight') {
            event.preventDefault();
            event.stopPropagation();
            next();
        }
    }, []);

    return {
        carouselHoverDirection,
        handleCarouselLayerClick,
        handleCarouselLayerPointerMove,
        handleCarouselLayerPointerLeave,
        handleCarouselLayerKeyDown,
    };
};

export default useCarousel;
