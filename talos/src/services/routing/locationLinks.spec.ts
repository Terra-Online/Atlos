import { beforeEach, describe, expect, it } from 'vitest';
import { REGION_DICT } from '@/data/map';
import { useMarkerStore } from '@/store/marker';
import useRegion from '@/store/region';
import { buildCleanUrl } from './cleanup';
import { parseUrlState } from './parse';
import { generateLocationShareUrl } from './share';

describe('location share links', () => {
    beforeEach(() => {
        localStorage.clear();
        useMarkerStore.setState({ filter: [] });
        useRegion.setState({ currentRegionKey: 'Wuling', currentSubregionKey: null });
    });

    it('encodes region, rounded coordinate, and zoom without the active filter', () => {
        useMarkerStore.setState({ filter: ['collection'] });
        const url = new URL(generateLocationShareUrl({
            lat: -123.456789,
            lng: 456.123456,
            zoom: 2.666,
        }));
        expect(url.origin).toBe('https://oem.re');
        expect(url.searchParams.get('r')).toBe('WL');
        expect(url.searchParams.get('c')).toBe('-123.45679,456.12346');
        expect(url.searchParams.get('z')).toBe('2.67');
        expect([...url.searchParams.keys()]).toEqual(['r', 'c', 'z']);
    });

    it('parses finite coordinates and rejects malformed values', () => {
        const valid = parseUrlState({ pathname: '/', search: '?r=WL&c=-1.25%2C2.5&z=3.25' });
        expect(valid.coordinate).toEqual([-1.25, 2.5]);
        expect(valid.zoom).toBe(3.25);

        expect(parseUrlState({ pathname: '/', search: '?r=WL&c=1' }).coordinate).toBeNull();
        expect(parseUrlState({ pathname: '/', search: '?r=WL&c=NaN%2C2' }).coordinate).toBeNull();
        expect(parseUrlState({ pathname: '/', search: '?r=WL&c=1%2CInfinity' }).coordinate).toBeNull();
    });

    it('removes location parameters during one-shot URL cleanup', () => {
        expect(buildCleanUrl({
            pathname: '/',
            search: '?r=WL&c=-1%2C2&z=2.5&auth_code=keep',
        }, null)).toBe('/?auth_code=keep');
    });

    it('uses valid configured region identifiers', () => {
        const state = parseUrlState({ pathname: '/', search: '?r=WL&c=1%2C2' });
        expect(state.regionKey && REGION_DICT[state.regionKey]).toBeTruthy();
    });
});
