import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { SolverSettings } from '#@/src/solver/contract.ts';

/** A child-process entry implements the IPC protocol in workers.ts. Dataset and
 * solver preparation stay inside that entry; timing, deadlines and scoring stay
 * in the harness. An adapter supplies policy defaults without loading its solver. */
export interface BenchmarkAdapter {
  defaults: SolverSettings;
  entry: URL;
  catalogTraining?: boolean;
}
export async function loadAdapter(path?: string): Promise<BenchmarkAdapter> {
  const url = path
    ? pathToFileURL(resolve(path))
    : new URL('./adapters/ganglia-v1/index.ts', import.meta.url);
  const { adapter } = (await import(url.href)) as { adapter: BenchmarkAdapter };
  if (!adapter || !(adapter.entry instanceof URL) || !adapter.defaults?.algorithm)
    throw new Error('Invalid benchmark adapter');
  return adapter;
}
export interface SceneMetadata {
  scene: string;
  source: unknown;
  hashes: Record<string, string>;
  gameAdapterSha256: string;
  kernelSha256: string;
  resolvedKernel: string;
  inputBytes: number;
  rules: { maxVertical: number };
  execution: { mode: string; workers: number; lanes: number; memory?: unknown };
}
export const sceneIdentity = (
  metadata: Pick<SceneMetadata, 'hashes' | 'gameAdapterSha256' | 'kernelSha256' | 'rules'>,
) =>
  JSON.stringify([
    metadata.hashes,
    metadata.gameAdapterSha256,
    metadata.kernelSha256,
    metadata.rules,
  ]);

/** Optional catalog-training extension, carried as data across IPC. */
export interface CatalogStats {
  phase: 'disabled' | 'training' | 'frozen';
  scopes: number;
  scopeResets: number;
  missingSupport: number;
  frozenScopeMisses: number;
  added: number;
  duplicates: number;
  evicted: number;
  frozenCalls: number;
  selections: number;
  selectedEdges: number;
  seedSelections: number;
  seededEdges: number;
  seededComponents: number;
  candidateChains: number;
  rankedStates: number;
  hits: number;
  misses: number;
  fallbacks: number;
}
