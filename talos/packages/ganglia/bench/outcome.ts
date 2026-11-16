import type { Evaluation } from '#@/src/evaluation/route.ts';
import type { RouteQuery, RouteResult } from '#@/src/solver/contract.ts';

export type Status = 'success' | 'no-route' | 'timeout' | 'error';

/** Search completion says nothing about independent verifier acceptance. */
export function classify(result: RouteResult): Status {
  if (
    result.reason === 'timeout' ||
    ('timedOut' in result.diagnostics && result.diagnostics.timedOut === true)
  )
    return 'timeout';
  if (
    result.reason === 'aborted' ||
    /^(input-(unavailable|invalid|unresolved)|unsupported-setup|execution-error):/.test(
      result.reason ?? '',
    )
  )
    return 'error';
  return result.route.status === 'complete' && !result.partial ? 'success' : 'no-route';
}

export interface Verification {
  verification: 'valid' | 'invalid' | 'error' | 'not-run';
  evaluation?: Evaluation;
  verificationError?: string;
  verificationMs: number;
}

/** The beta verifier is an observation, never a search or quality gate. */
export async function verifyResult(
  query: RouteQuery,
  result: RouteResult,
  verify?: (query: RouteQuery, result: RouteResult) => Promise<Evaluation>,
): Promise<Verification> {
  if (!verify || classify(result) !== 'success')
    return { verification: 'not-run', verificationMs: 0 };
  const started = performance.now();
  try {
    const evaluation = await verify(query, result);
    return {
      verification: evaluation.valid ? 'valid' : 'invalid',
      evaluation,
      verificationMs: performance.now() - started,
    };
  } catch (error) {
    return {
      verification: 'error',
      verificationError: String(error),
      verificationMs: performance.now() - started,
    };
  }
}
