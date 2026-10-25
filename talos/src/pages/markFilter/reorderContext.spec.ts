import { describe, expect, it } from 'vitest';
import { getReorderTargetIndex } from '@/pages/markFilter/reorderMath';
import { LayoutRect } from '@/pages/markFilter/reorderCore';

const layouts: Record<string, LayoutRect> = {
  a: { top: 0, height: 100, bottom: 100, center: 50 },
  b: { top: 100, height: 100, bottom: 200, center: 150 },
  c: { top: 200, height: 100, bottom: 300, center: 250 },
  d: { top: 300, height: 100, bottom: 400, center: 350 },
};

describe('getReorderTargetIndex', () => {
  it('allows the last category to cross several neighbours in one drag', () => {
    const origin = layouts.d;
    let order = ['a', 'b', 'c', 'd'];

    for (const dragY of [-110, -210, -310]) {
      const from = order.indexOf('d');
      const previousDragY = dragY + 100;
      const to = getReorderTargetIndex(order, 'd', dragY, previousDragY, origin, (id) => layouts[id]);
      expect(to).toBe(from - 1);
      const [dragged] = order.splice(from, 1);
      order.splice(to, 0, dragged);
    }

    expect(order).toEqual(['d', 'a', 'b', 'c']);
  });

  it('does not reorder when the dragged item has not crossed its neighbour', () => {
    expect(getReorderTargetIndex(
      ['a', 'b', 'c', 'd'],
      'd',
      -99,
      0,
      layouts.d,
      (id) => layouts[id],
    )).toBe(3);
  });

  it('reverses direction before returning across the original drag position', () => {
    let order = ['a', 'b', 'c', 'd'];
    const origin = layouts.a;

    for (const dragY of [110, 210, 310]) {
      const from = order.indexOf('a');
      const previousDragY = dragY - 100;
      const to = getReorderTargetIndex(order, 'a', dragY, previousDragY, origin, (id) => layouts[id]);
      expect(to).toBe(from + 1);
      const [dragged] = order.splice(from, 1);
      order.splice(to, 0, dragged);
    }
    expect(order).toEqual(['b', 'c', 'd', 'a']);

    for (const dragY of [210, 110]) {
      const from = order.indexOf('a');
      const previousDragY = dragY + 100;
      const to = getReorderTargetIndex(order, 'a', dragY, previousDragY, layouts.a, (id) => layouts[id]);
      expect(to).toBe(from - 1);
      const [dragged] = order.splice(from, 1);
      order.splice(to, 0, dragged);
    }
    expect(order).toEqual(['b', 'a', 'c', 'd']);
  });
});
