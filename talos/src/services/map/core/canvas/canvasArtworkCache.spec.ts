import { describe, expect, it, vi } from 'vitest';
import { MarkerPainter, type Sprite } from '@/services/map/core/canvas/canvasMarkerPaint';
import { MarkerMotionPool } from '@/services/map/core/canvas/canvasMarkerMotion';
const art = (i: number) => ({ image: '', subImage: '', noFrame: false, tier: `L${i}` });
const pose = () => { const pool = new MarkerMotionPool(); return pool.transition(pool.initial, 0, 0, false, false); };

describe('Shared immutable artwork', () => {
  it('reuses 700 live sprites after strong-cache eviction without repainting', () => {
    const painter = new MarkerPainter(2, () => {}), motion = pose(), paint = vi.spyOn(painter, 'paint');
    try {
      const sprites = Array.from({ length: 700 }, (_, i) => painter.sprite(art(i), motion, 1000));
      for (let i = 0; i < 700; i++) expect(painter.sprite(art(i), motion, 1000)).toBe(sprites[i]);
      expect(paint).toHaveBeenCalledTimes(700);
    } finally { painter.dispose(); }
  });
  it('bounds both indexes while preserving pixels still owned by entries', () => {
    const painter = new MarkerPainter(2, () => {}), motion = pose();
    const indexes = painter as unknown as { sprites: Map<string, Sprite>; shared: Map<string, WeakRef<Sprite>> };
    try {
      const live = Array.from({ length: 2500 }, (_, i) => painter.sprite(art(i), motion, 1000));
      expect(indexes.sprites.size).toBe(512);
      expect(indexes.shared.size).toBeLessThanOrEqual(2048);
      expect(painter.sprite(art(2499), motion, 1000)).toBe(live[2499]);
      expect([live[0].canvas.width, live[0].canvas.height]).toEqual([120, 132]);
      painter.setRatio(3);
      expect(indexes.shared.size).toBe(0);
      const refreshed = painter.sprite(art(0), motion, 1000);
      expect(refreshed).not.toBe(live[0]);
      expect(refreshed.canvas.width).toBe(180);
    } finally { painter.dispose(); }
    expect(indexes.sprites.size).toBe(0); expect(indexes.shared.size).toBe(0);
  });
  it('reuses cluster bodies across counts and badges across icons, including whole-group fades', () => {
    const painter = new MarkerPainter(2, () => {}), pool = new MarkerMotionPool();
    const appearing = pool.transition(pool.initial, 64, 0, false, true);
    const first = { image: '/one.png', subImage: '', noFrame: false, tier: '', count: '2' };
    try {
      const a = painter.gpuSprite(first, appearing, 50);
      const b = painter.gpuSprite({ ...first, count: '3' }, appearing, 50);
      const c = painter.gpuSprite({ ...first, image: '/two.png' }, appearing, 50);
      expect(a.parts).toHaveLength(2);
      expect(a.parts![0]).toBe(b.parts![0]);
      expect(a.parts![1]).toBe(c.parts![1]);
      expect(b.parts![1]).not.toBe(a.parts![1]);
      const settled = pool.transition(appearing, 0, 200, false, true);
      expect(painter.gpuSprite(first, settled, 200)).toBe(a);
      expect(painter.sprite(first, settled, 200).parts).toBeUndefined();
      const draw = vi.fn(); a.canvas.getContext('2d')!.drawImage = draw;
      expect(painter.raster(a)).toBe(a); painter.raster(a);
      expect(draw).toHaveBeenCalledTimes(2);
    } finally { painter.dispose(); }
  });
  it('keeps reusable material when a region retains its assets and evicts retired material', () => {
    const painter = new MarkerPainter(2, () => {}), motion = pose();
    const keep = { ...art(1), image: '/keep.png' }, retire = { ...art(2), image: '/retire.png' };
    try {
      const kept = painter.sprite(keep, motion, 1000), retired = painter.sprite(retire, motion, 1000);
      painter.retainAssets(new Set(['/keep.png']));
      expect(painter.sprite(keep, motion, 1000)).toBe(kept);
      expect(painter.sprite(retire, motion, 1000)).not.toBe(retired);
    } finally { painter.dispose(); }
  });
  it('keeps vector and unknown assets on the authored whole-sprite path', () => {
    const painter = new MarkerPainter(2, () => {}), motion = pose();
    try {
      for (const image of ['/icon.svg?cached=.webp', 'data:image/svg+xml,<svg/>', 'blob:opaque']) {
        expect(painter.gpuSprite({ ...art(1), image, count: '2' }, motion, 1000).parts).toBeUndefined();
      }
    } finally { painter.dispose(); }
  });
  it('can still paint when weak references are unavailable', () => {
    vi.stubGlobal('WeakRef', undefined);
    const painter = new MarkerPainter(2, () => {});
    try { expect(painter.sprite(art(0), pose(), 1000).canvas.width).toBe(120); }
    finally { painter.dispose(); vi.unstubAllGlobals(); }
  });
});
