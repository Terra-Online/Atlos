import type { PhysicalWork } from '#@/src/solver/resources.ts';
export type { PhysicalWork } from '#@/src/solver/resources.ts';
export const physicalWork = (step: 0 | 1 | 2): PhysicalWork => ({ version: 1, step });
export function readPhysicalWork(value: unknown): PhysicalWork {
  if (
    !value ||
    typeof value !== 'object' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('step' in value) ||
    (value.step !== 0 && value.step !== 1 && value.step !== 2)
  )
    throw new Error('Invalid physical work');
  return physicalWork(value.step);
}
export const physicalWorkPlan = (work: PhysicalWork = physicalWork(2)) => {
  readPhysicalWork(work);
  return {
    background: work.step === 2,
    devices: work.step !== 0,
    key: ['walking-route', 'device-route', 'route'][work.step],
    policy: work.step === 0 ? 14 : 18,
  };
};
