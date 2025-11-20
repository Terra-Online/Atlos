/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { useCallback } from 'react';
import { CallBackProps, EVENTS, STATUS } from 'react-joyride';
import {
    useSetSidebarOpen,
    useToggleMarkFilterExpanded,
    useUiPrefsStore,
    useSetDrawerSnapIndex,
    useSetForceSubregionOpen,
    useSetForceDetailOpen,
    useSetIsUserGuideOpen,
} from '@/store/uiPrefs';
import { useMarkerStore, useSwitchFilter } from '@/store/marker';
import { useAddPoint } from '@/store/userRecord';
import { MARKER_TYPE_TREE, WORLD_MARKS } from '@/data/marker';

export const useGuideActions = () => {
    const setSidebarOpen = useSetSidebarOpen();
    const toggleMarkFilterExpanded = useToggleMarkFilterExpanded();
    const switchFilter = useSwitchFilter();
    const addPoint = useAddPoint();
    const setCurrentActivePoint = useMarkerStore((s) => s.setCurrentActivePoint);
    const setDrawerSnapIndex = useSetDrawerSnapIndex();
    const setForceSubregionOpen = useSetForceSubregionOpen();
    const setForceDetailOpen = useSetForceDetailOpen();
    const setIsUserGuideOpen = useSetIsUserGuideOpen();

    const handleJoyrideCallback = useCallback(
        (data: CallBackProps) => {
            const { action, index, type, status } = data;

            if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
                setForceDetailOpen(false);
                setForceSubregionOpen(false);
                setDrawerSnapIndex(null);
                setIsUserGuideOpen(false);
                return;
            }

            if (type === EVENTS.STEP_AFTER && action === 'next') {
                // 1. Sidebar Toggle (Index 0) -> Open Sidebar
                if (index === 0) {
                    setSidebarOpen(true);
                }

                // 3. Filter Container (Index 2) -> Expand Filter
                if (index === 2) {
                    const firstKey = Object.keys(MARKER_TYPE_TREE)[0];
                    const isExpanded =
                        useUiPrefsStore.getState().markFilterExpanded[firstKey];
                    if (!isExpanded) {
                        toggleMarkFilterExpanded(firstKey);
                    }
                }

                // 5. Selector Select (Index 4) -> Select Filter
                if (index === 4) {
                    const firstKey = Object.keys(MARKER_TYPE_TREE)[0];
                    const firstType = Object.values(
                        MARKER_TYPE_TREE[firstKey],
                    )[0][0].key;
                    const currentFilter = useMarkerStore.getState().filter;
                    if (!currentFilter.includes(firstType)) {
                        switchFilter(firstType);
                    }
                }

                // 6. Selector Complete (Index 5) -> Mark Complete
                if (index === 5) {
                    const firstKey = Object.keys(MARKER_TYPE_TREE)[0];
                    const firstType = Object.values(
                        MARKER_TYPE_TREE[firstKey],
                    )[0][0].key;
                    const points = WORLD_MARKS.filter(
                        (m) => m.type === firstType,
                    );
                    points.forEach((p) => addPoint(p.id));
                }

                // 7. Trigger Handle (Index 6) -> Open Drawer
                if (index === 6) {
                    setDrawerSnapIndex(1);
                }

                // 8. Trigger Switch (Index 7) -> Close Sidebar & Drawer
                if (index === 7) {
                    setSidebarOpen(false);
                    setDrawerSnapIndex(0);
                }

                // 18. Region Switch (Index 17) -> Open Subregion
                if (index === 17) {
                    setForceSubregionOpen(true);
                }

                // 19. Subregion Switch (Index 18) -> Close Subregion
                if (index === 18) {
                    setForceSubregionOpen(false);
                }

                // 21. Point Select (Index 19) -> Select Point & Force Detail Open
                if (index === 19) {
                    const p = WORLD_MARKS[0];
                    if (p) setCurrentActivePoint(p);
                    setForceDetailOpen(true);
                }

                // 22. Point Mark (Index 20) -> Mark Point (Check)
                if (index === 20) {
                    const p = useMarkerStore.getState().currentActivePoint;
                    if (p) addPoint(p.id);
                }

                // 23. Point Icon (Index 22) -> Close Detail Force (allow close)
                if (index === 22) {
                    setForceDetailOpen(false);
                }
            }
        },
        [
            setSidebarOpen,
            toggleMarkFilterExpanded,
            switchFilter,
            addPoint,
            setCurrentActivePoint,
            setDrawerSnapIndex,
            setForceSubregionOpen,
            setForceDetailOpen,
            setIsUserGuideOpen,
        ],
    );

    return { handleJoyrideCallback };
};
