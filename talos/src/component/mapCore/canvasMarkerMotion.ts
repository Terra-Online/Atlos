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
  set(next: MarkerState, now: number, noFrame: boolean, cluster = false): void {
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
    const state = this.state;
    if (state?.disappearing) return (state.checked && !state.offLayer ? 0.3 : 1) * (1 - ease((now - this.fadeStart) / 150, curves.easeIn));
    if (state?.appearing && now < this.fadeStart + 150) return (state.checked && !state.offLayer ? 0.3 : 1) * ease((now - this.fadeStart) / 150, curves.easeOut);
    return this.alpha.value(now);
  }
  active(now: number): boolean {
    return !!this.state?.pulsing || (!!(this.state?.appearing || this.state?.disappearing) && now < this.fadeStart + 150)
      || this.channels.some(channel => channel.active(now));
  }
}
