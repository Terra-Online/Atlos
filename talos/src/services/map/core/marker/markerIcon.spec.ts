import { describe, expect, it, vi } from 'vitest';
import type { IMarkerType } from '@/data/marker';
import { MarkerPainter } from '@/services/map/core/canvas/canvasMarkerPaint';
import { MARKER_ICON_DICT } from './markerRenderer';

vi.mock('@/data/marker', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/data/marker')>();
    const type: IMarkerType = {
        key: 'bounce_device',
        category: { main: 'general', sub: 'facility' },
    };
    return {
        ...original,
        MARKER_TYPE_DICT: {
            ...original.MARKER_TYPE_DICT,
            bounce_device: type,
            empty_icon: { ...type, key: 'empty_icon', icon: '' },
            explicit_icon: { ...type, key: 'explicit_icon', icon: 'device' },
            ferrium_spot: { ...type, key: 'ferrium_spot', subIcon: 'mine_spot' },
        },
    };
});

describe('Marker artwork', () => {
    it('renders an empty-icon marker without waiting for a missing image', () => {
        const icon = MARKER_ICON_DICT.empty_icon;
        const painter = new MarkerPainter(1, () => {});
        try {
            expect(icon.art.image).toBe('');
            expect(icon.art.noFrame).toBe(false);
            expect(painter.isArtReady(icon.art)).toBe(true);
        } finally {
            painter.dispose();
        }
    });

    it('preserves default, explicit and gathering artwork paths', () => {
        expect(MARKER_ICON_DICT.bounce_device.art.image).toBe('/assets/images/item/bounce_device.webp');
        expect(MARKER_ICON_DICT.explicit_icon.art.image).toBe('/assets/images/item/device.webp');
        const gathering = MARKER_ICON_DICT.ferrium_spot;
        expect(gathering.art.image).toBe('/assets/images/marker/ferrium_spot.webp');
        expect(gathering.art.subImage).toBe('/assets/images/marker/sub/mine_spot.webp');
    });
});
