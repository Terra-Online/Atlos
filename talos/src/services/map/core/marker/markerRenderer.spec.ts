import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getMarkerLayer } from './markerRenderer';
import { getMarkerState } from '../canvas/markerModel';
import { MARKER_TYPE_DICT, type IMarkerData } from '@/data/marker';
import { useMarkerStore } from '@/store/marker';
import { useUserRecordStore } from '@/store/userRecord';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { useLayerStore } from '@/store/layer';
import { useHistoryStore } from '@/store/history';
import { MARKER_PREVIEW_ENTER_EVENT, MARKER_PREVIEW_LEAVE_EVENT } from '@/services/map/events/PreviewEvents';

const markerSnapshot = useMarkerStore.getState();
const recordSnapshot = useUserRecordStore.getState();
const prefsSnapshot = useUiPrefsStore.getState();
const layerSnapshot = useLayerStore.getState();
const historySnapshot = useHistoryStore.getState();
const point: IMarkerData = { id: 'node-free-renderer', type: Object.keys(MARKER_TYPE_DICT)[0],
    subregId: 'fixture', pos: [0, 0], tier: 0, x: 0, y: 0, z: 0 };

beforeEach(() => {
    useMarkerStore.setState({ filter: [], selectedPoints: [], temporarySelectedPoints: [] });
    useUserRecordStore.setState({ activePoints: [] });
    useUiPrefsStore.setState({ prefsMarkerProgressEnabled: true, prefsHideCompletedMarkers: false });
    useLayerStore.setState({ currentLayer: 'M' });
    useHistoryStore.getState().clear();
});
afterEach(() => {
    useMarkerStore.setState(markerSnapshot);
    useUserRecordStore.setState(recordSnapshot);
    useUiPrefsStore.setState(prefsSnapshot);
    useLayerStore.setState(layerSnapshot);
    useHistoryStore.setState(historySnapshot);
    vi.restoreAllMocks();
});

it('selects, collects and uncollects without a marker element', () => {
    const onClick = vi.fn();
    const marker = getMarkerLayer(point, onClick);
    marker.fire('add');
    expect(marker.getElement()).toBeUndefined();
    const click = () => marker.fire('click', { originalEvent: new MouseEvent('click') });
    click();
    expect(useMarkerStore.getState().filter).toContain(point.type);
    expect(getMarkerState(marker)).toMatchObject({ selected: true, checked: false });
    click();
    expect(useUserRecordStore.getState().activePoints).toContain(point.id);
    expect(getMarkerState(marker)).toMatchObject({ selected: false, checked: true, completed: true });
    click();
    expect(useUserRecordStore.getState().activePoints).not.toContain(point.id);
    expect(getMarkerState(marker)).toMatchObject({ selected: false, checked: false, completed: false });
    expect(onClick).toHaveBeenCalledTimes(3);
});

it('keeps preview lifecycle and Alt context menu behavior independent of DOM', () => {
    const onContextMenu = vi.fn();
    const marker = getMarkerLayer(point, undefined, undefined, { onContextMenu });
    const enter = vi.fn(), leave = vi.fn();
    window.addEventListener(MARKER_PREVIEW_ENTER_EVENT, enter);
    window.addEventListener(MARKER_PREVIEW_LEAVE_EVENT, leave);
    try {
        marker.fire('add').fire('mouseover').fire('viewporthide');
        expect(enter).toHaveBeenCalledTimes(1);
        expect(leave).toHaveBeenCalledTimes(1);
        expect(getMarkerState(marker).appearing).toBe(false);
        marker.fire('contextmenu', { originalEvent: new MouseEvent('contextmenu', { altKey: true }) });
        expect(onContextMenu).not.toHaveBeenCalled();
        const event = new MouseEvent('contextmenu', { cancelable: true });
        marker.fire('contextmenu', { originalEvent: event });
        expect(onContextMenu).toHaveBeenCalledWith(point, event);
        expect(event.defaultPrevented).toBe(true);
    } finally {
        window.removeEventListener(MARKER_PREVIEW_ENTER_EVENT, enter);
        window.removeEventListener(MARKER_PREVIEW_LEAVE_EVENT, leave);
    }
});
