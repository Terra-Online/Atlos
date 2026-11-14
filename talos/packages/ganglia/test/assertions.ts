import assert from 'node:assert/strict';

export function expectStatus<T extends { status: string }, S extends T['status']>(
  result: T,
  status: S,
): Extract<T, { status: S }> {
  assert.equal(result.status, status);
  return result as Extract<T, { status: S }>;
}
