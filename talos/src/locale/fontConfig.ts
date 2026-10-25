import type { Face, Region } from './fontShards';

export type Parts = Partial<Record<Face, string[]>>;
export interface Requirements {
    ui: Parts;
    shell: Parts;
}

// The font plugin replaces these exports with build/dev resource metadata.
// Tests and source-only builds keep empty resources and use system fallback.
export const manifests: Partial<Record<Region, string>> = {};
export const requirements: Partial<Record<Region, Requirements>> = {};
/** Build-time resolved shell URLs used to overlap byte fetching with manifest loading. */
export const shellFiles: Partial<
    Record<Region, Partial<Record<Face, string[]>>>
> = {};
