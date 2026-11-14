export function createTimings(preparationMs = 0) {
  const stagesMs: Record<string, number> = {};
  const preparation: Record<string, { hits: number; misses: number }> = {};
  return {
    preparationMs,
    workerStartupMs: 0,
    normalizationMs: 0,
    localSolveMs: 0,
    physical: {
      calls: 0,
      stagesMs,
      preparation,
    },
  };
}

export type Timings = ReturnType<typeof createTimings>;

// Preparation belongs to setup. Only query work is reset between warm and measured batches.
export function resetTimings(timings: Timings) {
  timings.normalizationMs = timings.localSolveMs = timings.physical.calls = 0;
  timings.physical.stagesMs = {};
  timings.physical.preparation = {};
}

export function mergeTimings(total: Timings, query: Timings) {
  total.normalizationMs += query.normalizationMs;
  total.localSolveMs += query.localSolveMs;
  total.physical.calls += query.physical.calls;
  for (const [stage, milliseconds] of Object.entries(query.physical.stagesMs))
    total.physical.stagesMs[stage] = (total.physical.stagesMs[stage] ?? 0) + milliseconds;
  for (const [slot, count] of Object.entries(query.physical.preparation)) {
    const current = (total.physical.preparation[slot] ??= { hits: 0, misses: 0 });
    current.hits += count.hits;
    current.misses += count.misses;
  }
}
