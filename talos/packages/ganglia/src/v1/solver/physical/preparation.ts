import type { PhysicalCache } from '#@/src/v1/solver/physical/solve.ts';
/** Preparation changes invalidate dependent geometry before storing a replacement. */
export function createPhysicalCache() {
  const slots = new Map<string, { key: string; value: unknown }>();
  // Alternating targets retain their refined support identity and physical proofs.
  // Each value owns a complete prepared ground graph, so bound this extra memory
  // to two targets and rebuild an evicted target rather than retaining every query.
  const refinements = new Map<string, unknown>();
  return {
    clear() {
      slots.clear();
      refinements.clear();
    },
    release(slot: 'ground' | 'moving') {
      slots.delete(slot);
    },
    async memo<T>(slot: string, key: string, create: () => T | Promise<T>) {
      if (slot === 'refinement') {
        if (refinements.has(key)) return { value: refinements.get(key) as T, reused: true };
        const value = await create();
        if (refinements.size >= 2) refinements.delete(refinements.keys().next().value!);
        refinements.set(key, value);
        return { value, reused: false };
      }
      const found = slots.get(slot);
      if (found?.key === key) return { value: found.value as T, reused: true };
      slots.delete(slot);
      if (slot === 'ground') for (const dependent of ['devices', 'moving']) slots.delete(dependent);
      if (slot === 'ground' || slot === 'moving') refinements.clear();
      const value = await create();
      slots.set(slot, { key, value });
      return { value, reused: false };
    },
  } satisfies PhysicalCache & { clear(): void };
}
