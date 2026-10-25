import { describe, expect, it } from 'vitest';
import {
    PIP_MOBILE_HEIGHT,
    PIP_MOBILE_WIDTH,
    createAppViewport,
} from '@/platform/pipViewport';

describe('createAppViewport', () => {
    it('uses the regular mobile breakpoint outside picture-in-picture', () => {
        const viewport = createAppViewport(1280, 720, false);

        expect(viewport.isPipMobile).toBe(false);
        expect(viewport.isPipCompact).toBe(false);
        expect(viewport.isPipUiTooSmall).toBe(false);
    });

    it('uses the inclusive width boundary for picture-in-picture mobile mode', () => {
        expect(createAppViewport(PIP_MOBILE_WIDTH, 800, true).isPipMobile).toBe(true);
        expect(createAppViewport(PIP_MOBILE_WIDTH + 1, 800, true).isPipMobile).toBe(false);
    });

    it('uses the strict height boundary for picture-in-picture mobile mode', () => {
        expect(createAppViewport(800, PIP_MOBILE_HEIGHT - 1, true).isPipMobile).toBe(true);
        expect(createAppViewport(800, PIP_MOBILE_HEIGHT, true).isPipMobile).toBe(false);
    });

    it('uses strict compact and minimum UI edge boundaries', () => {
        expect(createAppViewport(360, 600, true).isPipCompact).toBe(false);
        expect(createAppViewport(359, 600, true).isPipCompact).toBe(true);
        expect(createAppViewport(240, 600, true).isPipUiTooSmall).toBe(false);
        expect(createAppViewport(239, 600, true).isPipUiTooSmall).toBe(true);
    });
});
