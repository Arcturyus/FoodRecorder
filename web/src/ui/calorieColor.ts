/** Same 90–110% target zone; an opaque hue gradient avoids muddy dark cells. */
export function calorieColor(ratio: number): string {
  const under = ratio < 0.9;
  const distance = under ? (0.9 - ratio) / 0.55 : ratio > 1.1 ? (ratio - 1.1) / 0.5 : 0;
  const t = Math.max(0, Math.min(1, distance));
  const hue = 112 + ((under ? 0 : 270) - 112) * t;
  return `hsl(${hue} ${46 + 36 * t}% ${61 + 4 * t}%)`;
}
