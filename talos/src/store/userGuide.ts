import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface IUserGuideStore {
  stepCompleted: Record<string, boolean>;
  setStepCompleted: (stepId: string, completed: boolean) => void;

  setStepCompletedBulk: (updates: Record<string, boolean>) => void;
  replaceStepCompleted: (stepCompleted: Record<string, boolean>) => void;
}

type PersistedUserGuideState = Partial<Pick<IUserGuideStore, 'stepCompleted'>>;

export const useUserGuideStore = create<IUserGuideStore>()(
  persist(
    (set) => ({
      stepCompleted: {},
      setStepCompleted: (stepId, completed) =>
        set((state) => ({
          stepCompleted: { ...state.stepCompleted, [stepId]: completed },
        })),

      setStepCompletedBulk: (updates) =>
        set((state) => ({
          stepCompleted: { ...state.stepCompleted, ...updates },
        })),

      replaceStepCompleted: (stepCompleted) => set({ stepCompleted }),
    }),
    {
      name: 'UserGuide',
      version: 1,
      partialize: (state): PersistedUserGuideState => ({
        stepCompleted: state.stepCompleted,
      }),
      // Ignore legacy tutorial-version fields while retaining step completion
      // state. Tutorial updates are intentionally silent.
      migrate: (persistedState: unknown): PersistedUserGuideState => {
        const persisted =
          typeof persistedState === 'object' && persistedState !== null
            ? (persistedState as PersistedUserGuideState)
            : {};
        return { stepCompleted: persisted.stepCompleted };
      },
      merge: (persistedState: unknown, currentState) => {
        const persisted =
          typeof persistedState === 'object' && persistedState !== null
            ? (persistedState as PersistedUserGuideState)
            : {};
        return {
          ...currentState,
          stepCompleted: persisted.stepCompleted ?? currentState.stepCompleted,
        };
      },
    },
  ),
);

// Shared-map URLs should not trigger the first-run intro. This only marks the
// intro entries themselves; there is no guide-version bookkeeping anymore.
export const completeCurrentUserGuide = (): void => {
  useUserGuideStore.setState((state) => ({
    stepCompleted: {
      ...state.stepCompleted,
      'STEP-0_welcome': true,
      'MSTEP-0_welcome': true,
    },
  }));
};

// Export hooks for easy use
export const useUserGuideStepCompleted = () => useUserGuideStore((s) => s.stepCompleted);
export const useSetUserGuideStepCompleted = () => useUserGuideStore((s) => s.setStepCompleted);
export const useSetUserGuideStepCompletedBulk = () => useUserGuideStore((s) => s.setStepCompletedBulk);
export const useReplaceUserGuideStepCompleted = () => useUserGuideStore((s) => s.replaceStepCompleted);
