type RGB = [number, number, number];

/** Green (clean) → yellow → red (blown out), ColorBrewer RdYlGn reversed. */
const STOPS: [number, RGB][] = [
  [0, [26, 152, 80]],
  [0.25, [145, 207, 96]],
  [0.5, [254, 224, 139]],
  [0.75, [252, 141, 89]],
  [1, [215, 48, 39]],
];

export function rampColor(v: number): RGB {
  const x = Math.min(1, Math.max(0, v));
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i];
    if (x <= p1) {
      const [p0, c0] = STOPS[i - 1];
      const f = (x - p0) / (p1 - p0);
      return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * f)) as RGB;
    }
  }
  return STOPS[STOPS.length - 1][1];
}

/** 256-entry lookup indexed by chop byte value. */
export const RAMP_LUT: RGB[] = Array.from({ length: 256 }, (_, i) => rampColor(i / 255));

export const rampCss = (v: number) => `rgb(${rampColor(v).join(',')})`;

export const rampGradientCss = () =>
  `linear-gradient(to right, ${STOPS.map(([p, c]) => `rgb(${c.join(',')}) ${p * 100}%`).join(', ')})`;

export function chopLabel(v: number): string {
  if (v < 0.15) return 'Clean';
  if (v < 0.35) return 'Light texture';
  if (v < 0.55) return 'Bumpy';
  if (v < 0.75) return 'Choppy';
  return 'Blown out';
}
