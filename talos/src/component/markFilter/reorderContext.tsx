import React, { useCallback, useMemo, useRef, useState } from 'react';
import { DragContext, GetLayout, LayoutRect } from './reorderCore.tsx';
import { useMarkFilterOrder, useSetMarkFilterOrder } from '@/store/uiPrefs';

function moveItem<T>(arr: T[], from: number, to: number) {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export const MarkFilterDragProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // registered items and their measurement callbacks
  const registryRef = useRef<Map<string, { getLayout: GetLayout }>>(new Map());
  // visual order mapped to idKey; this drives flex order
  const persistedOrder = useMarkFilterOrder();
  const setPersistedOrder = useSetMarkFilterOrder();
  const [order, setOrder] = useState<string[]>(() => persistedOrder ?? []);
  const orderRef = useRef<string[]>(order);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragOriginCenterRef = useRef<number>(0);
  const dragOriginRectRef = useRef<LayoutRect | null>(null);

  const register = useCallback((id: string, getLayout: GetLayout) => {
    const m = registryRef.current;
    m.set(id, { getLayout });
    setOrder((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      orderRef.current = next;
      // persist structural change
      setTimeout(() => setPersistedOrder(next), 0);
      return next;
    });
  }, [setPersistedOrder]);

  const unregister = useCallback((id: string) => {
    const m = registryRef.current;
    m.delete(id);
  }, []);

  const orderOf = useCallback(
    (id: string) => {
      const idx = order.indexOf(id);
      // fallback to end if not registered yet
      return idx >= 0 ? idx : order.length;
    },
    [order]
  );

  const startDrag = useCallback((id: string) => {
    setDraggingId(id);
    // capture starting center of the dragged item
    const item = registryRef.current.get(id);
    if (item) {
      const r = item.getLayout();
      dragOriginCenterRef.current = r.center;
      dragOriginRectRef.current = r;
    } else {
      dragOriginCenterRef.current = 0;
      dragOriginRectRef.current = null;
    }
  }, []);

  const updateDrag = useCallback((id: string, dragY: number) => {
  if (draggingId !== id) return;

  const registry = registryRef.current;
  const originRect = dragOriginRectRef.current;
  if (!originRect) return;

  setOrder(prev => {
    const currentIndex = prev.indexOf(id);
    if (currentIndex === -1) return prev;

    const currentTop = originRect.top + dragY;
    const currentBottom = originRect.bottom + dragY;

    let newIndex = currentIndex;

    if (dragY < 0 && currentIndex > 0) {
      const upperId = prev[currentIndex - 1];
      const upperItem = registry.get(upperId);
      if (upperItem) {
        const upperRect = upperItem.getLayout();
        if (currentTop <= upperRect.top) {
          newIndex = currentIndex - 1;
        }
      }
    }
    else if (dragY > 0 && currentIndex < prev.length - 1) {
      const lowerId = prev[currentIndex + 1];
      const lowerItem = registry.get(lowerId);
      if (lowerItem) {
        const lowerRect = lowerItem.getLayout();
        if (currentBottom >= lowerRect.bottom) {
          newIndex = currentIndex + 1;
        }
      }
    }

    const firstId = prev[0];
    const firstRect = registry.get(firstId)?.getLayout();
    const lastId = prev[prev.length - 1];
    const lastRect = registry.get(lastId)?.getLayout();
    if (firstRect && currentTop <= firstRect.top) newIndex = 0;
    if (lastRect && currentBottom >= lastRect.bottom) newIndex = prev.length - 1;

    if (newIndex !== currentIndex) {
      const nextOrder = moveItem(prev, currentIndex, newIndex);

      const newItem = registry.get(id);
      if (newItem) {
        const newRect = newItem.getLayout();
        dragOriginRectRef.current = newRect;
        dragOriginCenterRef.current = newRect.center;
      }
      orderRef.current = nextOrder;
      return nextOrder;
    }

    return prev;
  });
}, [draggingId]);

  const endDrag = useCallback(() => {
    setDraggingId(null);
    dragOriginCenterRef.current = 0;
    dragOriginRectRef.current = null;
    // persist the final order after interaction ends
    setPersistedOrder(orderRef.current);
  }, [setPersistedOrder]);

  const value = useMemo(
    () => ({ register, unregister, startDrag, updateDrag, endDrag, orderOf, isDragging: !!draggingId, draggingId }),
    [register, unregister, startDrag, updateDrag, endDrag, orderOf, draggingId]
  );

  return <DragContext.Provider value={value}>{children}</DragContext.Provider>;
};