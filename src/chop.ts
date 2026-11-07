import type { ModelParams } from './config';
import { cellCenter, DIR_BINS, DIR_STEP, DIST_UNIT_KM, OPEN, type Grid } from './grid';
import { byronWeight, lerpSample, type WindFrame, type WindSample } from './wind';

/**
 * Per direction bin, how exposed each water cell is (0 = fully sheltered by
 * land just upwind, 1 = open water). Averaged over an upwind cone so a
 * narrow headland only partly shelters the water behind it.
 */
export function computeExposure(g: Grid, p: ModelParams): Float32Array {
  const n = g.water.length;
  const lut = new Float32Array(256);
  for (let d = 0; d < 256; d++) {
    lut[d] = d === OPEN ? 1 : 1 - p.shelter * Math.exp(-(d * DIST_UNIT_KM) / Math.max(0.1, p.recoveryKm));
  }
  const half = Math.round(p.coneDeg / DIR_STEP);
  const weights: number[] = [];
  for (let o = -half; o <= half; o++) weights.push(half + 1 - Math.abs(o));
  const wSum = weights.reduce((a, b) => a + b, 0);

  const out = new Float32Array(DIR_BINS * n);
  for (let b = 0; b < DIR_BINS; b++) {
    const base = b * n;
    for (let o = -half; o <= half; o++) {
      const src = (((b + o) % DIR_BINS) + DIR_BINS) % DIR_BINS * n;
      const w = weights[o + half] / wSum;
      for (let k = 0; k < n; k++) out[base + k] += lut[g.upwind[src + k]] * w;
    }
  }
  return out;
}

export function exposureAt(exposure: Float32Array, n: number, k: number, dirFrom: number): number {
  if (Number.isNaN(dirFrom)) return 1;
  const x = dirFrom / DIR_STEP;
  const b0 = Math.floor(x) % DIR_BINS;
  const b1 = (b0 + 1) % DIR_BINS;
  const f = x - Math.floor(x);
  return exposure[b0 * n + k] * (1 - f) + exposure[b1 * n + k] * f;
}

export function windFactor(w: WindSample, p: ModelParams): number {
  const u = w.speedKmh + p.gustWeight * Math.max(0, w.gustKmh - w.speedKmh);
  const s = (u - p.calmKmh) / Math.max(1, p.messyKmh - p.calmKmh);
  return Math.min(1, Math.max(0, s));
}

export interface ChopResult {
  /** [frame * nWater + k], 0–255: chop including settling memory. */
  chop: Uint8Array;
  /** Same, instantaneous wind-only target (no memory). */
  target: Uint8Array;
  nWater: number;
}

/** Fraction of the gap to the target closed over one step with e-folding time tau. */
const relax = (dtHours: number, tauHours: number) => (tauHours <= 0 ? 1 : 1 - Math.exp(-dtHours / tauHours));

export function runModel(g: Grid, frames: WindFrame[], weights: Float32Array, exposure: Float32Array, p: ModelParams): ChopResult {
  const n = g.water.length;
  const chop = new Uint8Array(frames.length * n);
  const target = new Uint8Array(frames.length * n);
  const state = new Float32Array(n);
  for (let f = 0; f < frames.length; f++) {
    const frame = frames[f];
    const dt = f === 0 ? 0 : (frame.t - frames[f - 1].t) / 36e5;
    const aUp = relax(dt, p.buildHours);
    const aDown = relax(dt, p.settleHours);
    const base = f * n;
    for (let k = 0; k < n; k++) {
      const w = lerpSample(frame.ballina, frame.byron, weights[k]);
      const tgt = windFactor(w, p) * exposureAt(exposure, n, k, w.dirFrom);
      let s = tgt;
      if (f > 0) {
        s = state[k];
        s += (tgt - s) * (tgt > s ? aUp : aDown);
      }
      state[k] = s;
      chop[base + k] = Math.round(s * 255);
      target[base + k] = Math.round(tgt * 255);
    }
  }
  return { chop, target, nWater: n };
}

/** Byron blend weight for each water cell. */
export function waterWeights(g: Grid): Float32Array {
  const out = new Float32Array(g.water.length);
  for (let k = 0; k < g.water.length; k++) out[k] = byronWeight(...cellCenter(g, g.water[k]));
  return out;
}
