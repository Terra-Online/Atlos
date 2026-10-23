import { useRef, type RefObject } from 'react';
import { isRecordToolEnabled } from '@/devtools/loadDevTool';
import { useFilter, useSetFilter } from '@/store/marker';
import {
    useBoxSelectionEngine,
    type BoxSelectionTarget,
} from '@/component/selection/useBoxSelectionEngine';

export const useBoxSelection = (
    containerRef: RefObject<HTMLDivElement | null>,
    selectionBoxRef: RefObject<HTMLDivElement | null>,
) => {
    const filter = useFilter();
    const setFilter = useSetFilter();
    const currentFilterRef = useRef(filter);
    currentFilterRef.current = filter;

    return useBoxSelectionEngine({
        containerRef,
        selectionBoxRef,
        getInitialKeys: () => currentFilterRef.current,
        onChange: setFilter,
        immediate: isRecordToolEnabled(),
        canStart: (target) => !(
            target.closest('button')
            || target.closest('input')
            || target.closest('[data-drag-handle]')
            || target.closest('[data-filter-header="true"]')
            || target.closest('[data-key]')
            || target.closest('[data-binder-wrap="true"]')
            || target.closest('div[class*="triggerDrawer"]')
        ),
        collectTargets: ({ container, scrollContainer, elementToContentRect }) => {
            const targets: BoxSelectionTarget[] = [];
            container.querySelectorAll<HTMLElement>('[data-key], [data-binder-keys]').forEach((element) => {
                if (!scrollContainer.contains(element)) return;
                if (element.checkVisibility && !element.checkVisibility()) return;
                const filterContent = element.closest('[data-filter-content="true"]');
                if (filterContent?.getAttribute('data-expanded') === 'false') return;

                const key = element.getAttribute('data-key');
                if (key) {
                    targets.push({
                        keys: [key],
                        rect: elementToContentRect(element),
                        element,
                        mode: 'toggle',
                    });
                }

                const keys = (element.getAttribute('data-binder-keys') ?? '')
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean);
                if (keys.length === 0) return;
                targets.push({
                    keys,
                    rect: elementToContentRect(element),
                    element: element.closest<HTMLElement>('[data-binder-wrap="true"]') ?? element,
                    mode: 'activate',
                });
            });
            return targets;
        },
        syncTarget: ({ element }, active) => {
            element.dataset.active = active ? 'true' : 'false';
        },
    });
};
