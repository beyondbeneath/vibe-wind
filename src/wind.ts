import type { Observation } from './bom';
import { STATIONS } from './config';

export interface WindSample {
  /** Degrees true the wind blows FROM; NaN when calm. */
  dirFrom: number;
  speedKmh: number;
  gustKmh: number;
}

export interface WindFrame {
  t: number;
  ballina: WindSample;
  byron: WindSample;
}

const STEP_MS = 30 * 60 * 1000;
/** Gaps longer than this in a station's record are treated as missing data. */
const MAX_GAP_MS = 3 * 60 * 60 * 1000;

const wrap360 = (d: number) => ((d % 360) + 360) % 360;

/** Interpolate angles along the shortest arc. */
export function lerpAngle(a: number, b: number, f: number): number {
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  const diff = ((b - a + 540) % 360) - 180;
  return wrap360(a + diff * f);
}

export function lerpSample(a: WindSample, b: WindSample, f: number): WindSample {
  return {
    dirFrom: lerpAngle(a.dirFrom, b.dirFrom, f),
    speedKmh: a.speedKmh + (b.speedKmh - a.speedKmh) * f,
    gustKmh: a.gustKmh + (b.gustKmh - a.gustKmh) * f,
  };
}

const toSample = (o: Observation): WindSample => ({
  dirFrom: o.dirFrom ?? NaN,
  speedKmh: o.speedKmh,
  gustKmh: o.gustKmh,
});

/** Sample a station's observations at time t (linear in time, clamped at the ends). */
export function sampleAt(obs: Observation[], t: number): WindSample | null {
  if (!obs.length) return null;
  if (t <= obs[0].t) return toSample(obs[0]);
  const last = obs[obs.length - 1];
  if (t >= last.t) return t - last.t <= MAX_GAP_MS ? toSample(last) : null;
  let lo = 0;
  let hi = obs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (obs[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = obs[lo];
  const b = obs[hi];
  if (b.t - a.t > MAX_GAP_MS) return null;
  return lerpSample(toSample(a), toSample(b), (t - a.t) / (b.t - a.t));
}

/** Build a 30-minute timeline covering both stations' records. */
export function buildFrames(ballina: Observation[], byron: Observation[]): WindFrame[] {
  if (!ballina.length && !byron.length) return [];
  const firsts = [ballina[0]?.t, byron[0]?.t].filter((x): x is number => x != null);
  const lasts = [ballina.at(-1)?.t, byron.at(-1)?.t].filter((x): x is number => x != null);
  const start = Math.ceil(Math.max(...firsts) / STEP_MS) * STEP_MS;
  const end = Math.floor(Math.max(...lasts) / STEP_MS) * STEP_MS;
  const frames: WindFrame[] = [];
  for (let t = start; t <= end; t += STEP_MS) {
    const a = sampleAt(ballina, t);
    const b = sampleAt(byron, t);
    if (!a && !b) continue;
    // If one station is missing, use the other everywhere.
    frames.push({ t, ballina: a ?? b!, byron: b ?? a! });
  }
  return frames;
}

// Local flat-earth projection (km) centred between the stations.
const LAT0 = (STATIONS.ballina.lat + STATIONS.byron.lat) / 2;
const KM_PER_DEG_LAT = 110.57;
const KM_PER_DEG_LON = 111.32 * Math.cos((LAT0 * Math.PI) / 180);

const ax = STATIONS.ballina.lon * KM_PER_DEG_LON;
const ay = STATIONS.ballina.lat * KM_PER_DEG_LAT;
const bx = STATIONS.byron.lon * KM_PER_DEG_LON;
const by = STATIONS.byron.lat * KM_PER_DEG_LAT;
const axisLen2 = (bx - ax) ** 2 + (by - ay) ** 2;

/**
 * Blend weight towards Cape Byron for a location: 0 at/south of Ballina,
 * 1 at/north of Byron, smooth in between along the station axis.
 */
export function byronWeight(lat: number, lon: number): number {
  const px = lon * KM_PER_DEG_LON - ax;
  const py = lat * KM_PER_DEG_LAT - ay;
  const f = Math.min(1, Math.max(0, (px * (bx - ax) + py * (by - ay)) / axisLen2));
  return f * f * (3 - 2 * f);
}

export function windAt(frame: WindFrame, weight: number): WindSample {
  return lerpSample(frame.ballina, frame.byron, weight);
}

/** Unit vector the wind blows TOWARDS (east, north components). */
export function toVector(dirFrom: number): [number, number] {
  const rad = (dirFrom * Math.PI) / 180;
  return [-Math.sin(rad), -Math.cos(rad)];
}

export { KM_PER_DEG_LAT, KM_PER_DEG_LON };
