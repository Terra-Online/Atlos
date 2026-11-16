/** Metres and seconds throughout. These tolerances describe representation and
 * reporting error, never extra movement speed or resources. Contact tolerance bounds skin overlap.
 * These defaults are tunable: if human review finds a tolerance too strict for
 * practical use, it may be relaxed to an appropriate value. */
export interface VerificationPolicy {
  /** Horizontal radius for ordinary point goals; interactions and waypoints keep their own rules. */
  goalTolerance: number;
  /** Distance between submitted and control-replayed traces; collision remains checked. */
  traceTolerance: number;
  /** Polyline approximation of supported walking, independent of flight replay precision. */
  walkTraceTolerance: number;
  /** Allowed walking capsule skin overlap with raw triangles; flight and walls remain strict. */
  walkContactTolerance: number;
  /** Timestamp rounding when comparing the submitted resource replay. */
  timeTolerance: number;
  /** Maximum vertical correction of walk intent; zero requires physical feet directly. */
  walkSnap: number;
  /** Absolute reporting tolerances, combined with relativeTolerance. */
  costTolerance: number;
  lengthTolerance: number;
  relativeTolerance: number;
}
export const verificationDefaults: Readonly<VerificationPolicy> = Object.freeze({
  goalTolerance: 0.05,
  traceTolerance: 0.005,
  walkTraceTolerance: 0.025,
  walkContactTolerance: 0.01,
  timeTolerance: 0.001,
  walkSnap: 0.35,
  costTolerance: 0.01,
  lengthTolerance: 0.01,
  relativeTolerance: 0.001,
});
export function verificationPolicy(options: Partial<VerificationPolicy> = {}): VerificationPolicy {
  const policy = { ...verificationDefaults, ...options };
  for (const key of Object.keys(verificationDefaults) as (keyof VerificationPolicy)[])
    if (!Number.isFinite(policy[key]) || policy[key] < 0)
      throw new Error(`Invalid verification ${key}`);
  return policy;
}
export const within = (a: number, b: number, absolute: number, relative = 0) =>
  Number.isFinite(a) &&
  Number.isFinite(b) &&
  Math.abs(a - b) <= absolute + relative * Math.max(Math.abs(a), Math.abs(b));
