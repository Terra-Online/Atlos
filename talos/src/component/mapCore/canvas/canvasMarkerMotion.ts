/** Numeric animation channels never own or invalidate image assets. */
export type Curve = readonly [number, number, number, number];
export const curves = {
  presto: [0.6, 0, 0, 1], adagio: [0.6, 0, 0.6, 1],
  moderato: [0.8, 0.2, 0.35, 0.7], standard: [0.4, 0, 0.2, 1],
  easeIn: [0.42, 0, 1, 1], easeOut: [0, 0, 0.58, 1],
} satisfies Record<string, Curve>;
export function ease(t: number, [x1, y1, x2, y2]: Curve): number {
  if (t <= 0 || t >= 1) return Math.max(0, Math.min(1, t));
  const sample = (u: number, a: number, b: number) => 3 * (1 - u) ** 2 * u * a + 3 * (1 - u) * u * u * b + u ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (sample(mid, x1, x2) < t) lo = mid; else hi = mid;
  }
  return sample((lo + hi) / 2, y1, y2);
}
export class Motion {
  private from: number;
  private start = 0;
  private duration = 0;
  private curve: Curve = curves.presto;
  constructor(public target: number) { this.from = target; }
  copyTo(target: Motion): void {
    target.from = this.from; target.target = this.target; target.start = this.start;
    target.duration = this.duration; target.curve = this.curve;
  }
  jump(value: number): void { this.from = this.target = value; this.duration = 0; }
  value(now: number): number {
    if (!this.active(now)) return this.target;
    return this.from + (this.target - this.from) * ease((now - this.start) / this.duration, this.curve);
  }
  to(target: number, now: number, duration: number, curve: Curve = curves.presto): void {
    if (target === this.target) return;
    this.from = this.value(now); this.target = target;
    this.start = now; this.duration = duration; this.curve = curve;
  }
  active(now: number): boolean { return now < this.start + this.duration && this.from !== this.target; }
}

export interface MarkerState {
  selected: boolean; checked: boolean; offLayer: boolean;
  hover: boolean; focus: boolean; pulsing: boolean; appearing: boolean; disappearing: boolean;
}
export class MarkerMotion {
  readonly alpha = new Motion(1);
  readonly imageAlpha = new Motion(1);
  readonly subAlpha = new Motion(1);
  readonly ringAlpha = new Motion(0);
  readonly ringOffset = new Motion(12);
  readonly border = new Motion(0);
  readonly background = new Motion(0);
  readonly arrow = new Motion(0);
  readonly shift = new Motion(0);
  readonly invert = new Motion(0);
  readonly grayscale = new Motion(0);
  readonly subScale = new Motion(1);
  readonly hoverDecoration = new Motion(0);
  readonly selectedDecoration = new Motion(0);
  readonly hoverScale = new Motion(1.2);
  readonly selectedScale = new Motion(1.2);
  private channels: Motion[] = [this.alpha, this.imageAlpha, this.subAlpha, this.ringAlpha, this.ringOffset,
    this.border, this.background, this.arrow, this.shift, this.invert, this.grayscale, this.subScale,
    this.hoverDecoration, this.selectedDecoration, this.hoverScale, this.selectedScale];
  pulseStart = 0;
  fadeStart = 0;
  state?: MarkerState;
  flags = -1;
  kind = 0;
  private sampledAt = NaN;
  private sampledOpacity = 1;
  private sampledActive = false;
  private sampledPaint = false;
  fork(): MarkerMotion {
    const copy = new MarkerMotion();
    this.channels.forEach((channel, index) => channel.copyTo(copy.channels[index]));
    copy.pulseStart = this.pulseStart; copy.fadeStart = this.fadeStart;
    copy.state = this.state; copy.flags = this.flags; copy.kind = this.kind;
    return copy;
  }
  set(next: MarkerState, now: number, noFrame: boolean, cluster = false): void {
    this.sampledAt = NaN; this.kind = +noFrame | (+cluster << 1);
    this.flags = +next.selected | (+next.checked << 1) | (+next.offLayer << 2) | (+next.hover << 3)
      | (+next.focus << 4) | (+next.pulsing << 5) | (+next.appearing << 6) | (+next.disappearing << 7);
    const previous = this.state;
    const duration = previous ? 150 : 0;
    this.alpha.to(next.checked && !noFrame ? 0.3 : 1, now, duration, curves.easeIn);
    this.imageAlpha.to(next.checked && noFrame ? 0.5 : 1, now, duration ? 300 : 0, curves.moderato);
    this.subAlpha.to(next.checked ? 0.5 : 1, now, duration, curves.easeIn);
    this.border.to(+next.selected, now, duration, curves.moderato);
    this.background.to(+next.checked, now, duration, curves.moderato);
    this.arrow.to(+next.selected, now, duration ? 300 : 0);
    this.invert.to(+next.selected, now, noFrame && duration ? 300 : 0, curves.standard);
    this.grayscale.to(+(next.offLayer && !(noFrame && next.selected)), now, noFrame && duration ? 300 : 0,
      next.selected ? curves.standard : curves.moderato);
    this.shift.to(next.hover ? cluster ? -2.5 : -5 : 0, now, next.hover ? 350 : 300, curves.moderato);
    const ringDuration = next.selected ? 125 : next.hover ? 250 : 350;
    this.ringAlpha.to(next.selected ? 1 : next.hover ? cluster ? 0.6 : 0.4 : 0, now, previous ? ringDuration : 0,
      next.selected ? curves.adagio : next.hover ? curves.easeIn : curves.presto);
    this.ringOffset.to(next.selected ? 6 : next.hover ? cluster ? 10 : 8 : 12, now, previous ? ringDuration : 0,
      next.selected ? curves.adagio : next.hover ? curves.easeIn : curves.presto);
    this.subScale.to(next.hover ? 1.05 : 1, now, 350);
    this.hoverDecoration.to(+(next.hover && !next.selected), now, next.hover || next.selected ? 350 : 500);
    this.selectedDecoration.to(+next.selected, now, 350);
    this.hoverScale.to(next.hover || next.selected ? 1 : 1.2, now, next.hover || next.selected ? 350 : 500);
    this.selectedScale.to(next.selected ? 1.05 : 1.2, now, 350);
    if (next.pulsing && !previous?.pulsing) this.pulseStart = now;
    if ((next.appearing && !previous?.appearing) || (next.disappearing && !previous?.disappearing)) this.fadeStart = now;
    this.state = next;
  }
  opacity(now: number): number {
    this.sample(now); return this.sampledOpacity;
  }
  private sample(now: number): void {
    if (this.sampledAt === now) return;
    this.sampledAt = now;
    const state = this.state;
    this.sampledOpacity = state?.disappearing ? (state.checked && !state.offLayer ? 0.3 : 1) * (1 - ease((now - this.fadeStart) / 150, curves.easeIn))
      : state?.appearing && now < this.fadeStart + 150 ? (state.checked && !state.offLayer ? 0.3 : 1) * ease((now - this.fadeStart) / 150, curves.easeOut)
      : this.alpha.value(now);
    this.sampledPaint = !!state?.pulsing || this.channels.some((channel, index) => index !== 0 && channel.active(now));
    this.sampledActive = this.sampledPaint || this.alpha.active(now)
      || (!!(state?.appearing || state?.disappearing) && now < this.fadeStart + 150);
  }
  active(now: number): boolean {
    this.sample(now); return this.sampledActive;
  }
  paintActive(now: number): boolean { this.sample(now); return this.sampledPaint; }
}

/** Copy-on-write transition cohorts: shared poses are never mutated by another point. */
export class MarkerMotionPool {
  readonly initial = new MarkerMotion();
  private at = NaN;
  private activeTransitions = new WeakMap<MarkerMotion, Map<number, MarkerMotion>>();
  private restTransitions = new Map<number, MarkerMotion>();
  private states = new Map<number, MarkerState>();
  transition(previous: MarkerMotion, flags: number, now: number, noFrame: boolean, cluster: boolean): MarkerMotion {
    const kind = +noFrame | (+cluster << 1), targetKey = flags | (kind << 8);
    if (previous.flags === flags && previous.kind === kind) return previous;
    if (now !== this.at) { this.at = now; this.activeTransitions = new WeakMap(); this.restTransitions.clear(); }
    let cache: Map<number, MarkerMotion>, key = targetKey;
    if (previous.active(now)) {
      let found = this.activeTransitions.get(previous);
      if (!found) this.activeTransitions.set(previous, found = new Map<number, MarkerMotion>());
      cache = found;
    } else {
      cache = this.restTransitions;
      key |= ((previous.flags + 1) | (previous.kind << 9)) << 10;
    }
    let motion = cache.get(key);
    if (motion) return motion;
    let state = this.states.get(flags);
    if (!state) {
      state = { selected: !!(flags & 1), checked: !!(flags & 2), offLayer: !!(flags & 4), hover: !!(flags & 8),
        focus: !!(flags & 16), pulsing: !!(flags & 32), appearing: !!(flags & 64), disappearing: !!(flags & 128) };
      this.states.set(flags, state);
    }
    motion = previous.fork(); motion.set(state, now, noFrame, cluster); cache.set(key, motion); return motion;
  }
}
