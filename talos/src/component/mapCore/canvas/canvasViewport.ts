/** Requested cache margin in CSS pixels; keep backing pixels within 150% of the viewport. */
const PAN_PADDING = 128;
export function canvasPadding(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0;
  const budget = (Math.sqrt((width + height) ** 2 + 2 * width * height) - width - height) / 4;
  return Math.max(0, Math.min(PAN_PADDING, Math.floor(budget)));
}
