import { GRID } from './config';
import { KM_PER_DEG_LAT, KM_PER_DEG_LON } from './wind';

export type Ring = [number, number][]; // [lon, lat]

export const DIR_STEP = 5;
export const DIR_BINS = 360 / DIR_STEP;
/** Upwind land distances are stored as Uint8 in units of this many km. */
export const DIST_UNIT_KM = 0.1;
/** Sentinel: no land found within MAX_FETCH_KM upwind. */
export const OPEN = 255;
export const MAX_FETCH_KM = 25;

export interface Grid {
  nx: number;
  ny: number;
  cellKm: number;
  dLon: number;
  dLat: number;
  west: number;
  north: number;
  south: number;
  east: number;
  /** 1 = land, row-major from the north-west corner. */
  land: Uint8Array;
  /** Grid indices of water cells. */
  water: Int32Array;
  /** Reverse lookup: grid index -> position in `water`, or -1 for land. */
  waterPos: Int32Array;
  /** [bin * water.length + k] = upwind distance to land for direction bin (wind FROM bin*5°). */
  upwind: Uint8Array;
}

export function cellCenter(g: Grid, idx: number): [number, number] {
  const i = idx % g.nx;
  const j = (idx / g.nx) | 0;
  return [g.north - (j + 0.5) * g.dLat, g.west + (i + 0.5) * g.dLon];
}

/** Even-odd scanline rasterisation of rings at cell centres. */
export function rasterise(rings: Ring[], g: Pick<Grid, 'nx' | 'ny' | 'dLon' | 'dLat' | 'west' | 'north'>): Uint8Array {
  const land = new Uint8Array(g.nx * g.ny);
  const xs: number[] = [];
  for (let j = 0; j < g.ny; j++) {
    const lat = g.north - (j + 0.5) * g.dLat;
    xs.length = 0;
    for (const ring of rings) {
      for (let k = 0, n = ring.length; k < n; k++) {
        const [x1, y1] = ring[k];
        const [x2, y2] = ring[(k + 1) % n];
        if (y1 > lat !== y2 > lat) xs.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - g.west) / g.dLon - 0.5));
      const i1 = Math.min(g.nx - 1, Math.floor((xs[k + 1] - g.west) / g.dLon - 0.5));
      for (let i = i0; i <= i1; i++) land[j * g.nx + i] = 1;
    }
  }
  return land;
}

/** March upwind from every water cell in each direction bin until land is hit. */
export function computeUpwind(land: Uint8Array, nx: number, ny: number, water: Int32Array, cellKm: number): Uint8Array {
  const n = water.length;
  const out = new Uint8Array(DIR_BINS * n);
  const maxSteps = Math.ceil(MAX_FETCH_KM / cellKm);
  for (let b = 0; b < DIR_BINS; b++) {
    const rad = (b * DIR_STEP * Math.PI) / 180;
    // Wind comes FROM this bearing, so upwind is towards it.
    const di = Math.sin(rad);
    const dj = -Math.cos(rad);
    const base = b * n;
    for (let k = 0; k < n; k++) {
      const idx = water[k];
      const i0 = idx % nx;
      const j0 = (idx / nx) | 0;
      let dist = OPEN;
      for (let s = 1; s <= maxSteps; s++) {
        const i = Math.round(i0 + di * s);
        const j = Math.round(j0 + dj * s);
        if (i < 0 || j < 0 || i >= nx || j >= ny) break;
        if (land[j * nx + i]) {
          dist = Math.min(OPEN - 1, Math.round((s * cellKm) / DIST_UNIT_KM));
          break;
        }
      }
      out[base + k] = dist;
    }
  }
  return out;
}

export function buildGrid(rings: Ring[]): Grid {
  const dLon = GRID.cellKm / KM_PER_DEG_LON;
  const dLat = GRID.cellKm / KM_PER_DEG_LAT;
  const nx = Math.round((GRID.east - GRID.west) / dLon);
  const ny = Math.round((GRID.north - GRID.south) / dLat);
  const geom = { nx, ny, dLon, dLat, west: GRID.west, north: GRID.north };
  const land = rasterise(rings, geom);
  const waterList: number[] = [];
  const waterPos = new Int32Array(nx * ny).fill(-1);
  for (let idx = 0; idx < land.length; idx++) {
    if (!land[idx]) {
      waterPos[idx] = waterList.length;
      waterList.push(idx);
    }
  }
  const water = Int32Array.from(waterList);
  return {
    ...geom,
    cellKm: GRID.cellKm,
    south: GRID.north - ny * dLat,
    east: GRID.west + nx * dLon,
    land,
    water,
    waterPos,
    upwind: computeUpwind(land, nx, ny, water, GRID.cellKm),
  };
}

/** Grid index of the water cell nearest to a point, or -1 if none nearby. */
export function nearestWater(g: Grid, lat: number, lon: number, maxCells = 10): number {
  const ci = Math.floor((lon - g.west) / g.dLon);
  const cj = Math.floor((g.north - lat) / g.dLat);
  let best = -1;
  let bestD = Infinity;
  for (let dj = -maxCells; dj <= maxCells; dj++) {
    for (let di = -maxCells; di <= maxCells; di++) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) continue;
      const idx = j * g.nx + i;
      const d = di * di + dj * dj;
      if (!g.land[idx] && d < bestD) {
        bestD = d;
        best = idx;
      }
    }
  }
  return best;
}

/**
 * Bearing towards the nearest land around a water cell, i.e. the wind
 * direction that is dead offshore there. NaN if no land is close.
 */
export function offshoreBearing(g: Grid, waterK: number): number {
  const n = g.water.length;
  let sx = 0;
  let sy = 0;
  for (let b = 0; b < DIR_BINS; b++) {
    const d = g.upwind[b * n + waterK];
    if (d === OPEN) continue;
    const w = Math.exp(-(d * DIST_UNIT_KM) / 1.0);
    const rad = (b * DIR_STEP * Math.PI) / 180;
    sx += Math.sin(rad) * w;
    sy += Math.cos(rad) * w;
  }
  if (Math.hypot(sx, sy) < 1e-6) return NaN;
  return (((Math.atan2(sx, sy) * 180) / Math.PI) + 360) % 360;
}
