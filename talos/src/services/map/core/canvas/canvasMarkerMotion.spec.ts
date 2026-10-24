import { describe, expect, it } from 'vitest';
import { curves, ease, MarkerMotionPool } from './canvasMarkerMotion';

describe('Marker appearance opacity', () => {
  it.each([
    { noFrame: false, offLayer: false, alpha: 0.3 },
    { noFrame: false, offLayer: true, alpha: 0.3 },
    { noFrame: true, offLayer: false, alpha: 1 },
    { noFrame: true, offLayer: true, alpha: 1 },
  ])('joins the settled checked pose without a jump: %j', ({ noFrame, offLayer, alpha }) => {
    const pool = new MarkerMotionPool(), checked = 2 | (offLayer ? 4 : 0);
    const appearing = pool.transition(pool.initial, checked | 64, 1000, noFrame, false);
    expect(appearing.opacity(1000)).toBe(0);
    for (const elapsed of [25, 75, 125, 149]) {
      expect(appearing.opacity(1000 + elapsed)).toBeCloseTo(alpha * ease(elapsed / 150, curves.easeOut), 8);
    }
    expect(appearing.opacity(1150) - appearing.opacity(1149)).toBeLessThan(0.001);
    const settled = pool.transition(appearing, checked, 1150, noFrame, false);
    expect(settled.opacity(1150)).toBe(alpha);
    const disappearing = pool.transition(settled, checked | 128, 1200, noFrame, false);
    expect(disappearing.opacity(1200)).toBe(alpha);
    expect(disappearing.opacity(1275)).toBeCloseTo(alpha * (1 - ease(0.5, curves.easeIn)), 8);
    expect(disappearing.opacity(1350)).toBe(0);
  });
});
