import React, { useCallback, useMemo, useRef, useState } from 'react';
import { DragContext, GetLayout, LayoutRect } from './reorderCore.tsx';
import { getReorderTargetIndex } from './reorderMath';
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
  const dragOriginRectRef = useRef<LayoutRect | null>(null);
  const previousDragYRef = useRef(0);

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
    previousDragYRef.current = 0;
    // Capture the starting layout rect as the drag reference frame.
    const item = registryRef.current.get(id);
    if (item) {
      const r = item.getLayout();
      dragOriginRectRef.current = r;
    } else {
      dragOriginRectRef.current = null;
    }
  }, []);

  const updateDrag = useCallback((id: string, dragY: number) => {
    if (draggingId !== id) return;

    const registry = registryRef.current;
    const originRect = dragOriginRectRef.current;
    if (!originRect) return;

    // Read the current order ref directly. Motion can call this on every
    // pointer frame; avoiding a state updater on frames that do not cross a
    // neighbour keeps React out of the hot path.
    const prev = orderRef.current;
    // Motion's y value is cumulative from drag start. Keep the original
    // rect as the only reference frame; resetting it after a reorder would
    // mix the cumulative offset with a new layout position and stop later
    // swaps from crossing their neighbours' thresholds.
    const newIndex = getReorderTargetIndex(
      prev,
      id,
      dragY,
      previousDragYRef.current,
      originRect,
      (targetId) => registry.get(targetId)?.getLayout(),
    );
    previousDragYRef.current = dragY;
    if (newIndex < 0 || newIndex === prev.indexOf(id)) return;

    const nextOrder = moveItem(prev, prev.indexOf(id), newIndex);
    orderRef.current = nextOrder;
    setOrder(nextOrder);
  }, [draggingId]);

  const endDrag = useCallback(() => {
    setDraggingId(null);
    previousDragYRef.current = 0;
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
