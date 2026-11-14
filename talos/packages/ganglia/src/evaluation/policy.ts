/** Metres and seconds throughout. These tolerances describe representation and
 * reporting error, never extra movement speed, resources or collision clearance. */
export interface VerificationPolicy {
  /** Horizontal radius for ordinary point goals; interactions and waypoints keep their own rules. */
  goalTolerance: number;
  /** Distance between submitted and control-replayed traces; collision remains checked. */
  traceTolerance: number;
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
  timeTolerance: 0.001,
  walkSnap: 0.2,
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
