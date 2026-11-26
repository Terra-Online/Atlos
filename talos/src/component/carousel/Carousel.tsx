import type { ReactNode } from 'react';
import { useCarousel, type CarouselOptions } from './useCarousel';

type Props<T> = CarouselOptions<T> & {
    children: (state: ReturnType<typeof useCarousel<T>>) => ReactNode;
};

export default function Carousel<T>({ children, ...options }: Props<T>) {
    return children(useCarousel(options));
}
