import { beforeEach, describe, expect, it } from 'vitest';
import {
    applyPointProgressSilently,
    commitPointProgress,
    replacePointProgressFromExternal,
    useHistoryStore,
} from '@/store/history';
import { useMarkerStore } from '@/store/marker';
import { useUserRecordStore } from '@/store/userRecord';

const activePoints = () => useUserRecordStore.getState().activePoints;

describe('point progress history', () => {
    beforeEach(() => {
        useUserRecordStore.setState({ activePoints: [], updatedAt: 0 });
        useHistoryStore.setState({ past: [], future: [] });
        useMarkerStore.setState({
            filter: [],
            selectedPoints: [],
            temporarySelectedPoints: [],
        });
    });

    it('records only the point ids that actually changed', () => {
        replacePointProgressFromExternal(['existing', 'remove']);

        expect(commitPointProgress('batch', {
            collect: ['existing', 'new', 'new'],
            uncollect: ['remove', 'missing'],
        })).toBe(true);
        expect(activePoints()).toEqual(['existing', 'new']);
        expect(useHistoryStore.getState().past).toEqual([{
            label: 'batch',
            collectedIds: ['new'],
            uncollectedIds: ['remove'],
        }]);
    });

    it('does not record no-op commands', () => {
        replacePointProgressFromExternal(['point-a']);

        expect(commitPointProgress('already collected', { collect: ['point-a'] })).toBe(false);
        expect(commitPointProgress('already absent', { uncollect: ['point-b'] })).toBe(false);
        expect(useHistoryStore.getState().past).toHaveLength(0);
    });

    it('undoes and redoes a batch as one exact delta', () => {
        replacePointProgressFromExternal(['existing', 'remove']);
        commitPointProgress('batch', { collect: ['new'], uncollect: ['remove'] });

        useHistoryStore.getState().undo();
        expect(activePoints()).toEqual(['existing', 'remove']);
        expect(useHistoryStore.getState().past).toHaveLength(0);
        expect(useHistoryStore.getState().future).toHaveLength(1);

        useHistoryStore.getState().redo();
        expect(activePoints()).toEqual(['existing', 'new']);
        expect(useHistoryStore.getState().past).toHaveLength(1);
        expect(useHistoryStore.getState().future).toHaveLength(0);
    });

    it('clears redo when a new manual command creates a branch', () => {
        commitPointProgress('first', { collect: ['point-a'] });
        useHistoryStore.getState().undo();

        commitPointProgress('second', { collect: ['point-b'] });
        expect(useHistoryStore.getState().future).toHaveLength(0);
        expect(activePoints()).toEqual(['point-b']);
    });

    it('treats external replacement as a history barrier', () => {
        commitPointProgress('first', { collect: ['point-a'] });
        useHistoryStore.getState().undo();

        replacePointProgressFromExternal(['remote']);
        expect(activePoints()).toEqual(['remote']);
        expect(useHistoryStore.getState().past).toHaveLength(0);
        expect(useHistoryStore.getState().future).toHaveLength(0);
    });

    it('applies silent changes without modifying either history stack', () => {
        commitPointProgress('first', { collect: ['point-a'] });
        useHistoryStore.getState().undo();

        expect(applyPointProgressSilently({ collect: ['guide-point'] })).toBe(true);
        expect(activePoints()).toEqual(['guide-point']);
        expect(useHistoryStore.getState().past).toHaveLength(0);
        expect(useHistoryStore.getState().future).toHaveLength(1);
    });

    it('keeps only the latest 25 manual commands', () => {
        for (let index = 0; index < 30; index += 1) {
            commitPointProgress(`collect-${index}`, { collect: [`point-${index}`] });
        }

        const { past } = useHistoryStore.getState();
        expect(past).toHaveLength(25);
        expect(past[0].label).toBe('collect-5');
        expect(past[24].label).toBe('collect-29');
    });

    it('does not record filter or selection changes', () => {
        const markerStore = useMarkerStore.getState();
        markerStore.switchFilter('type-a');
        markerStore.setSelected('selected', true);
        markerStore.setTemporarySelected('temporary', true);

        expect(useHistoryStore.getState().past).toHaveLength(0);
        expect(useHistoryStore.getState().future).toHaveLength(0);
    });

    it('notifies point progress subscribers for commit, undo, and redo', () => {
        const snapshots: string[][] = [];
        const unsubscribe = useUserRecordStore.subscribe((state) => {
            snapshots.push([...state.activePoints]);
        });

        try {
            commitPointProgress('collect', { collect: ['point-a'] });
            useHistoryStore.getState().undo();
            useHistoryStore.getState().redo();
        } finally {
            unsubscribe();
        }

        expect(snapshots).toEqual([['point-a'], [], ['point-a']]);
    });

    it('never changes filter, selected, or temporary-selected state', () => {
        useMarkerStore.setState({
            filter: ['type-a'],
            selectedPoints: ['selected'],
            temporarySelectedPoints: ['temporary'],
        });

        commitPointProgress('collect', { collect: ['point-a'] });
        useHistoryStore.getState().undo();

        const markerState = useMarkerStore.getState();
        expect(markerState.filter).toEqual(['type-a']);
        expect(markerState.selectedPoints).toEqual(['selected']);
        expect(markerState.temporarySelectedPoints).toEqual(['temporary']);
    });
});
