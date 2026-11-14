// The soft deadline requests cancellation at solver checkpoints. Input loading and queueing are
// separate from the latency SLO, and a timed-out search provides no complete route.
export const QUERY_SLO_MS = 300_000;
