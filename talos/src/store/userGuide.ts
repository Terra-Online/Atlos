import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface IUserGuideStore {
  version: string;
  setVersion: (version: string) => void;
  
  stepCompleted: Record<string, boolean>;
  setStepCompleted: (stepId: string, completed: boolean) => void;

  setStepCompletedBulk: (updates: Record<string, boolean>) => void;
  replaceStepCompleted: (stepCompleted: Record<string, boolean>) => void;
}

export const useUserGuideStore = create<IUserGuideStore>()(
  persist(
    (set) => ({
      version: '',
      setVersion: (version) => set({ version }),
      
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
    },
  ),
);

// Export hooks for easy use
export const useUserGuideVersion = () => useUserGuideStore((s) => s.version);
export const useSetUserGuideVersion = () => useUserGuideStore((s) => s.setVersion);
export const useUserGuideStepCompleted = () => useUserGuideStore((s) => s.stepCompleted);
export const useSetUserGuideStepCompleted = () => useUserGuideStore((s) => s.setStepCompleted);
export const useSetUserGuideStepCompletedBulk = () => useUserGuideStore((s) => s.setStepCompletedBulk);
export const useReplaceUserGuideStepCompleted = () => useUserGuideStore((s) => s.replaceStepCompleted);