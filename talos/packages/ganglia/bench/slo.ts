// The soft deadline requests cancellation at solver checkpoints. Input loading and queueing are
// separate from the latency SLO, and a timed-out search provides no complete route.
export const QUERY_SLO_MS = Number(process.env.GANGLIA_BENCHMARK_QUERY_SLO_MS ?? 300_000);
if (!Number.isSafeInteger(QUERY_SLO_MS) || QUERY_SLO_MS <= 0)
  throw new Error('GANGLIA_BENCHMARK_QUERY_SLO_MS must be a positive integer in milliseconds');
