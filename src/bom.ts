import type { Station } from './config';

export interface Observation {
  /** UTC epoch milliseconds. */
  t: number;
  /** Direction the wind blows FROM, degrees true; null when calm/missing. */
  dirFrom: number | null;
  speedKmh: number;
  gustKmh: number;
}

export interface StationSeries {
  station: Station;
  observations: Observation[];
  source: 'live' | 'sample';
}

const COMPASS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

export function compassToDeg(dir: string | null | undefined): number | null {
  if (!dir) return null;
  const i = COMPASS.indexOf(dir.trim().toUpperCase());
  return i < 0 ? null : i * 22.5;
}

export function degToCompass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

function parseUtc(s: string): number {
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12));
}

interface BomRecord {
  aifstime_utc: string;
  wind_dir: string | null;
  wind_spd_kmh: number | null;
  gust_kmh: number | null;
}

export function parseBom(json: unknown): Observation[] {
  const data = (json as { observations?: { data?: BomRecord[] } }).observations?.data ?? [];
  const obs: Observation[] = [];
  for (const r of data) {
    if (!r.aifstime_utc || r.wind_spd_kmh == null) continue;
    const calm = r.wind_dir === 'CALM' || r.wind_spd_kmh === 0;
    obs.push({
      t: parseUtc(r.aifstime_utc),
      dirFrom: calm ? null : compassToDeg(r.wind_dir),
      speedKmh: calm ? 0 : r.wind_spd_kmh,
      gustKmh: Math.max(r.gust_kmh ?? r.wind_spd_kmh, r.wind_spd_kmh),
    });
  }
  return obs.sort((a, b) => a.t - b.t);
}

const CACHE_DAYS = 14;

/** Merge with locally cached history so the time range can exceed BOM's 72 h. */
function mergeWithCache(stationId: string, fresh: Observation[]): Observation[] {
  const key = `bom-obs-${stationId}`;
  const byTime = new Map<number, Observation>();
  try {
    for (const o of JSON.parse(localStorage.getItem(key) ?? '[]') as Observation[]) byTime.set(o.t, o);
  } catch {
    /* corrupt cache: ignore */
  }
  for (const o of fresh) byTime.set(o.t, o);
  const cutoff = Date.now() - CACHE_DAYS * 864e5;
  const merged = [...byTime.values()].filter((o) => o.t >= cutoff).sort((a, b) => a.t - b.t);
  try {
    localStorage.setItem(key, JSON.stringify(merged));
  } catch {
    /* storage full or disabled */
  }
  return merged;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export async function loadStation(station: Station): Promise<StationSeries> {
  const path = `fwo/IDN60801/IDN60801.${station.id}.json`;
  try {
    const obs = parseBom(await getJson(`/bom/${path}`));
    if (!obs.length) throw new Error('no observations');
    return { station, observations: mergeWithCache(station.id, obs), source: 'live' };
  } catch (err) {
    console.warn(`Live BOM feed failed for ${station.name}, using bundled sample`, err);
    const obs = parseBom(await getJson(`${import.meta.env.BASE_URL}sample/IDN60801.${station.id}.json`));
    return { station, observations: obs, source: 'sample' };
  }
}
