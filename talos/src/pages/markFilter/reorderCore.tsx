import { createContext, useContext } from 'react';

export type LayoutRect = { top: number; height: number; bottom: number; center: number };

export type GetLayout = () => LayoutRect;

export type DragContextValue = {
  register: (id: string, getLayout: GetLayout) => void;
  unregister: (id: string) => void;
  startDrag: (id: string) => void;
  updateDrag: (id: string, dragY: number) => void;
  endDrag: () => void;
  orderOf: (id: string) => number;
  isDragging: boolean;
  draggingId: string | null;
};

export const DragContext = createContext<DragContextValue | null>(null);

export function useMarkFilterDragContext(): DragContextValue {
  const ctx = useContext(DragContext);
  if (!ctx) {
    throw new Error('useMarkFilterDragContext must be used within <MarkFilterDragProvider>');
  }
  return ctx;
}
