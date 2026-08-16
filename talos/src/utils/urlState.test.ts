import { beforeEach, describe, expect, it } from 'vitest';
import useRegion from '@/store/region';
import {
    CURRENT_USER_GUIDE_VERSION,
    useUserGuideStore,
} from '@/store/userGuide';
import {
    applyUrlParams,
    shouldSuppressInitialAutoOverlays,
} from './url/apply';

describe('URL state user guide handling', () => {
    beforeEach(() => {
        localStorage.clear();
        window.history.replaceState({}, '', '/');
        useRegion.setState({
            currentRegionKey: 'Valley_4',
            currentSubregionKey: null,
        });
        useUserGuideStore.setState({
            version: '',
            completedVersion: '',
            stepCompleted: {},
        });
    });

    it('completes the current guide before applying map link parameters', async () => {
        window.history.replaceState({}, '', '/?r=WL');

        await applyUrlParams();

        expect(useRegion.getState().currentRegionKey).toBe('Wuling');
        expect(useUserGuideStore.getState()).toMatchObject({
            version: CURRENT_USER_GUIDE_VERSION,
            completedVersion: CURRENT_USER_GUIDE_VERSION,
        });
        expect(shouldSuppressInitialAutoOverlays()).toBe(true);
    });

    it('does not complete the guide for authentication-only parameters', async () => {
        window.history.replaceState({}, '', '/?token=test-token');

        await applyUrlParams();

        expect(useUserGuideStore.getState()).toMatchObject({
            version: '',
            completedVersion: '',
        });
        expect(shouldSuppressInitialAutoOverlays()).toBe(false);
    });
});
