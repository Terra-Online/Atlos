import { LayoutRect } from './reorderCore';

export function getReorderTargetIndex(
  order: string[],
  id: string,
  dragY: number,
  previousDragY: number,
  originRect: LayoutRect,
  getLayout: (id: string) => LayoutRect | undefined,
) {
  const currentIndex = order.indexOf(id);
  if (currentIndex === -1) return -1;

  const currentTop = originRect.top + dragY;
  const currentBottom = originRect.bottom + dragY;
  const dragDelta = dragY - previousDragY;
  if (dragDelta < 0 && currentIndex > 0) {
    const upperRect = getLayout(order[currentIndex - 1]);
    if (upperRect && currentTop <= upperRect.top) return currentIndex - 1;
  } else if (dragDelta > 0 && currentIndex < order.length - 1) {
    const lowerRect = getLayout(order[currentIndex + 1]);
    if (lowerRect && currentBottom >= lowerRect.bottom) return currentIndex + 1;
  }

  return currentIndex;
}
