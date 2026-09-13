import { describe, expect, it, vi } from 'vitest';
import { MarkerPainter, type Sprite } from './canvasMarkerPaint';
import { MarkerMotionPool } from './canvasMarkerMotion';
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
  it('can still paint when weak references are unavailable', () => {
    vi.stubGlobal('WeakRef', undefined);
    const painter = new MarkerPainter(2, () => {});
    try { expect(painter.sprite(art(0), pose(), 1000).canvas.width).toBe(120); }
    finally { painter.dispose(); vi.unstubAllGlobals(); }
  });
});
