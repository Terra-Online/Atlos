import { loadNativeLibrary } from '#@/prototype/rust-kernel/native.ts';
import type { LocomotionOptions, Segment } from '#@/src/movement.ts';
import type { ScheduleChooser } from '#@/src/v1/resource/locomotion.ts';

export interface NativeScheduleOptions extends LocomotionOptions {
  /** Evaluated in JavaScript to preserve the exact turn threshold. */
  turnCosine: number;
  maxLabels?: number;
}

export type NativeScheduleBlock = {
  segments: Pick<Segment, 'mode' | 'points' | 'times' | 'boost' | 'requiredGait'>[];
};

/** Empty means infeasible; otherwise [truncated, sprint0, dash0, sprint1, dash1, ...].
 * Blocks have already been validated, grouped and split at dash decisions by the
 * TypeScript scheduler. Its winner replay retains authored metadata and goal events.
 */
export type NativeChooseSchedule = (
  blocks: NativeScheduleBlock[],
  options: NativeScheduleOptions,
) => Float64Array;

export const { chooseSchedule } = loadNativeLibrary() as { chooseSchedule: NativeChooseSchedule };

export const chooseRustSchedule = (
  blocks: Segment[][],
  options: LocomotionOptions,
  maxLabels = 256,
): Float64Array =>
  chooseSchedule(
    blocks.map((segments) => ({ segments })),
    { ...options, turnCosine: Math.cos(Math.PI / 6), maxLabels },
  );

export const createRustScheduleChooser =
  (maxLabels = 256): ScheduleChooser =>
  (blocks, options) => {
    const result = chooseRustSchedule(blocks, options, maxLabels);
    if (!result.length) return null;
    return {
      truncated: result[0] === 1,
      maxLabels,
      choices: blocks.map((_, index) => ({
        allowSprint: result[1 + index * 2] === 1,
        allowDash: result[2 + index * 2] === 1,
      })),
    };
  };
