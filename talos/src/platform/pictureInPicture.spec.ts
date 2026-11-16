import { expect, it, vi } from 'vitest';

vi.mock('@/locale', () => ({ useTranslateUI: () => (key: string) => key }));

it('leaves Leaflet untouched until the map registers and keeps drag cleanup on close', async () => {
    const L = (await import('leaflet')).default;
    const prototype = L.Draggable.prototype;
    const onDown = (): unknown => Reflect.get(prototype, '_onDown');
    const originals = Object.getOwnPropertyDescriptors(prototype);
    const draggable = L.Draggable as typeof L.Draggable & {
        _dragging?: { finishDrag: (noInertia: boolean) => void } | false;
    };
    const originalDragging = draggable._dragging;
    try {
        const pip = await import('./pictureInPicture');
        expect(onDown()).toBe(originals._onDown.value);
        expect(() => pip.closeAppPictureInPicture()).not.toThrow();
        pip.installLeafletPictureInPicture(L);
        expect(onDown()).not.toBe(originals._onDown.value);
        const patched = onDown();
        pip.installLeafletPictureInPicture(L);
        expect(onDown()).toBe(patched);

        const finishDrag = vi.fn();
        draggable._dragging = { finishDrag };
        pip.closeAppPictureInPicture();
        expect(finishDrag).toHaveBeenCalledWith(true);
        expect(draggable._dragging).toBe(false);
    } finally {
        for (const key of ['_onDown', '_onMove', '_onUp', 'finishDrag', '__talosPatched']) {
            const descriptor = originals[key];
            if (descriptor) Object.defineProperty(prototype, key, descriptor);
            else Reflect.deleteProperty(prototype, key);
        }
        draggable._dragging = originalDragging;
    }
});
