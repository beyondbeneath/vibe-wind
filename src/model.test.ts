import { describe, expect, it } from 'vitest';
import { compassToDeg, parseBom } from './bom';
import { computeExposure, runModel, windFactor } from './chop';
import { DEFAULT_PARAMS } from './config';
import { computeUpwind, DIR_BINS, DIR_STEP, OPEN, offshoreBearing, rasterise, type Grid } from './grid';
import { buildFrames, lerpAngle, sampleAt, type WindFrame } from './wind';

describe('BOM parsing', () => {
  it('maps compass points and calm', () => {
    expect(compassToDeg('N')).toBe(0);
    expect(compassToDeg('WSW')).toBe(247.5);
    expect(compassToDeg('CALM')).toBeNull();
    const obs = parseBom({
      observations: {
        data: [
          { aifstime_utc: '20261106030000', wind_dir: 'SSE', wind_spd_kmh: 15, gust_kmh: 22 },
          { aifstime_utc: '20261106023000', wind_dir: 'CALM', wind_spd_kmh: 0, gust_kmh: 0 },
          { aifstime_utc: '20261106020000', wind_dir: '-', wind_spd_kmh: null, gust_kmh: null },
        ],
      },
    });
    expect(obs).toHaveLength(2);
    expect(obs[0]).toMatchObject({ dirFrom: null, speedKmh: 0 });
    expect(obs[1]).toMatchObject({ dirFrom: 157.5, speedKmh: 15, gustKmh: 22 });
    expect(obs[1].t).toBe(Date.UTC(2026, 10, 6, 3, 0));
  });
});

describe('wind interpolation', () => {
  it('blends angles along the shortest arc', () => {
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(0);
    expect(lerpAngle(10, 350, 0.25)).toBeCloseTo(5);
    expect(lerpAngle(NaN, 90, 0.1)).toBe(90);
  });

  it('samples observations in time and builds a shared timeline', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const a = [
      { t: t0, dirFrom: 0, speedKmh: 10, gustKmh: 10 },
      { t: t0 + 36e5, dirFrom: 90, speedKmh: 20, gustKmh: 30 },
    ];
    expect(sampleAt(a, t0 + 18e5)).toMatchObject({ dirFrom: 45, speedKmh: 15, gustKmh: 20 });
    expect(buildFrames(a, a)).toHaveLength(3);
  });
});

/** 20x20 grid of 0.2 km cells; land fills the western half (coast runs N–S). */
function testGrid(): Grid {
  const nx = 20;
  const ny = 20;
  const geom = { nx, ny, dLon: 1, dLat: 1, west: 0, north: 20 };
  const land = rasterise([[[-5, -5], [10, -5], [10, 25], [-5, 25]]], geom);
  const water = Int32Array.from([...land.keys()].filter((i) => !land[i]));
  const waterPos = new Int32Array(nx * ny).fill(-1);
  water.forEach((idx, k) => (waterPos[idx] = k));
  return {
    ...geom,
    cellKm: 0.2,
    south: 0,
    east: 20,
    land,
    water,
    waterPos,
    upwind: computeUpwind(land, nx, ny, water, 0.2),
  };
}

describe('upwind fetch', () => {
  const g = testGrid();
  const n = g.water.length;
  const k = g.waterPos[10 * g.nx + 12]; // 3 cells east of the coast
  const bin = (deg: number) => deg / DIR_STEP;

  it('rasterises the land half', () => {
    expect(g.land[10 * g.nx + 9]).toBe(1);
    expect(g.land[10 * g.nx + 10]).toBe(0);
  });

  it('finds land upwind for offshore (westerly) wind and none for onshore', () => {
    expect(g.upwind[bin(270) * n + k]).toBe(6); // 3 cells * 0.2 km / 0.1
    expect(g.upwind[bin(90) * n + k]).toBe(OPEN);
    expect(Math.abs(offshoreBearing(g, k) - 270)).toBeLessThan(3);
  });

  it('rates offshore water cleaner than onshore at the same speed', () => {
    const exp = computeExposure(g, DEFAULT_PARAMS);
    expect(exp.length).toBe(DIR_BINS * n);
    expect(exp[bin(270) * n + k]).toBeLessThan(0.3);
    expect(exp[bin(90) * n + k]).toBeCloseTo(1);
  });
});

describe('chop model', () => {
  it('ignores light wind and saturates strong wind', () => {
    expect(windFactor({ dirFrom: 90, speedKmh: 5, gustKmh: 5 }, DEFAULT_PARAMS)).toBe(0);
    expect(windFactor({ dirFrom: 90, speedKmh: 40, gustKmh: 50 }, DEFAULT_PARAMS)).toBe(1);
  });

  it('leaves leftover chop after onshore swings offshore', () => {
    const g = testGrid();
    const p = { ...DEFAULT_PARAMS, buildHours: 0.5, settleHours: 5 };
    const exp = computeExposure(g, p);
    const t0 = Date.UTC(2026, 0, 1);
    const frames: WindFrame[] = [];
    for (let h = 0; h < 24; h += 0.5) {
      const dirFrom = h < 12 ? 90 : 270; // 12 h onshore, then offshore
      const s = { dirFrom, speedKmh: 30, gustKmh: 30 };
      frames.push({ t: t0 + h * 36e5, ballina: s, byron: s });
    }
    const weights = new Float32Array(g.water.length);
    const res = runModel(g, frames, weights, exp, p);
    const k = g.waterPos[10 * g.nx + 11];
    const at = (h: number) => res.chop[h * 2 * res.nWater + k] / 255;
    const target = (h: number) => res.target[h * 2 * res.nWater + k] / 255;
    expect(at(11)).toBeGreaterThan(0.9);
    expect(target(13)).toBeLessThan(0.3);
    expect(at(13)).toBeGreaterThan(0.6);
    expect(at(23)).toBeLessThan(at(13));
  });
});
