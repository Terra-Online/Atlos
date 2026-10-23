import { useRef, type RefObject } from 'react';
import { useBoxSelectionEngine } from '@/component/selection/useBoxSelectionEngine';

interface ScopedBoxSelectionOptions {
    containerRef: RefObject<HTMLElement | null>;
    selectionBoxRef: RefObject<HTMLDivElement | null>;
    itemSelector: string;
    keyAttribute: string;
    activeAttribute?: string;
    getInitialKeys?: () => Iterable<string>;
    onChange: (keys: string[]) => void;
}

export const useScopedBoxSelection = ({
    containerRef,
    selectionBoxRef,
    itemSelector,
    keyAttribute,
    activeAttribute,
    getInitialKeys,
    onChange,
}: ScopedBoxSelectionOptions) => {
    const currentKeysRef = useRef<string[]>([]);
    currentKeysRef.current = Array.from(getInitialKeys?.() ?? []);

    return useBoxSelectionEngine({
        containerRef,
        selectionBoxRef,
        selectionBoxCoordinates: 'auto',
        getInitialKeys: () => currentKeysRef.current,
        onChange,
        canStart: (target) => !(
            target.closest('button, a, input, textarea, select, [data-drag-handle]')
            || target.closest(itemSelector)
        ),
        collectTargets: ({ container, scrollContainer, elementToContentRect }) => (
            Array.from(container.querySelectorAll<HTMLElement>(itemSelector))
                .filter((element) => (
                    scrollContainer.contains(element)
                    && (element.checkVisibility?.() ?? element.offsetParent !== null)
                ))
                .map((element) => ({
                    keys: [element.getAttribute(keyAttribute) ?? ''],
                    rect: elementToContentRect(element),
                    element,
                    mode: 'toggle' as const,
                }))
                .filter(({ keys }) => keys[0].length > 0)
        ),
        syncTarget: ({ element }, active) => {
            if (activeAttribute) element.setAttribute(activeAttribute, active ? 'true' : 'false');
            element.setAttribute('aria-pressed', active ? 'true' : 'false');
        },
    });
};
