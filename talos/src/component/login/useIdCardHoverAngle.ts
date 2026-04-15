import { type MouseEvent, useCallback, useEffect, useRef } from 'react';

const ANGLE_EPSILON = 0.05;
const ENTER_SMOOTH_MS = 120;
const LEAVE_SMOOTH_MS = 150;

export const useIdCardHoverAngle = () => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const currentAngleRef = useRef(90);
  const continuousAngleRef = useRef(90);
  const lastNormalizedAngleRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const normalizeAngle = useCallback((angle: number) => (angle + 360) % 360, []);

  const setCardHoverAngle = useCallback((angle: number) => {
    const card = cardRef.current;
    if (!card) return;
    card.style.setProperty('--idcard-hover-angle', `${angle.toFixed(2)}deg`);
  }, []);

  const cancelAngleAnimation = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  const animateAngleTo = useCallback((target: number, durationMs: number) => {
    cancelAngleAnimation();

    const from = currentAngleRef.current;
    const diff = target - from;
    if (Math.abs(diff) <= ANGLE_EPSILON) {
      currentAngleRef.current = target;
      setCardHoverAngle(target);
      return;
    }

    let startTime: number | null = null;
    const step = (timestamp: number) => {
      if (startTime === null) {
        startTime = timestamp;
      }

      const elapsed = timestamp - startTime;
      const t = Math.min(elapsed / durationMs, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + diff * eased;

      currentAngleRef.current = next;
      setCardHoverAngle(next);

      if (t >= 1) {
        rafIdRef.current = null;
        return;
      }

      rafIdRef.current = requestAnimationFrame(step);
    };

    rafIdRef.current = requestAnimationFrame(step);
  }, [cancelAngleAnimation, setCardHoverAngle]);

  useEffect(() => {
    setCardHoverAngle(90);
    return () => {
      cancelAngleAnimation();
    };
  }, [cancelAngleAnimation, setCardHoverAngle]);

  const shortestDelta = useCallback((fromNormalized: number, toNormalized: number) => {
    let delta = toNormalized - fromNormalized;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return delta;
  }, []);

  const handleCardMouseMove = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;

    const rect = card.getBoundingClientRect();
    const localX = event.clientX - rect.left - rect.width / 2;
    const localY = event.clientY - rect.top - rect.height / 2;

    // Convert DOM coordinates (y down) to requested cartesian basis (y up).
    const x = localX;
    const y = -localY;
    const rawAngle = (Math.atan2(x, y) * 180) / Math.PI;
    const normalizedAngle = normalizeAngle(rawAngle);

    const previousNormalized = lastNormalizedAngleRef.current;
    if (previousNormalized === null) {
      const currentNormalized = normalizeAngle(currentAngleRef.current);
      const delta = shortestDelta(currentNormalized, normalizedAngle);
      const entryTarget = currentAngleRef.current + delta;

      lastNormalizedAngleRef.current = normalizedAngle;
      continuousAngleRef.current = entryTarget;
      animateAngleTo(entryTarget, ENTER_SMOOTH_MS);
      return;
    }

    cancelAngleAnimation();
    const delta = shortestDelta(previousNormalized, normalizedAngle);
    const nextContinuous = continuousAngleRef.current + delta;

    continuousAngleRef.current = nextContinuous;
    currentAngleRef.current = nextContinuous;
    lastNormalizedAngleRef.current = normalizedAngle;
    setCardHoverAngle(nextContinuous);
  }, [animateAngleTo, cancelAngleAnimation, normalizeAngle, setCardHoverAngle, shortestDelta]);

  const handleCardMouseLeave = useCallback(() => {
    const currentNormalized = normalizeAngle(currentAngleRef.current);
    const delta = shortestDelta(currentNormalized, 90);
    const leaveTarget = currentAngleRef.current + delta;

    continuousAngleRef.current = leaveTarget;
    lastNormalizedAngleRef.current = null;
    animateAngleTo(leaveTarget, LEAVE_SMOOTH_MS);
  }, [animateAngleTo, normalizeAngle, shortestDelta]);

  return {
    cardRef,
    handleCardMouseMove,
    handleCardMouseLeave,
  };
};