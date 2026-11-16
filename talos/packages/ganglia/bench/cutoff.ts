// A benchmark runtime budget, independent of any performance target. Cancellation
// is cooperative, so a running stage may finish after the cutoff.
export const QUERY_CUTOFF_MS = Number(process.env.GANGLIA_BENCHMARK_QUERY_CUTOFF_MS ?? 60_000);
if (!Number.isSafeInteger(QUERY_CUTOFF_MS) || QUERY_CUTOFF_MS <= 0)
  throw new Error('GANGLIA_BENCHMARK_QUERY_CUTOFF_MS must be a positive integer in milliseconds');
