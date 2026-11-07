export interface Station {
  id: string;
  name: string;
  lat: number;
  lon: number;
  url: string;
}

const BOM_PAGE = 'https://www.bom.gov.au/products/IDN60801/IDN60801';

export const STATIONS = {
  ballina: {
    id: '94596',
    name: 'Ballina Airport',
    lat: -28.8353,
    lon: 153.5585,
    url: `${BOM_PAGE}.94596.shtml`,
  },
  byron: {
    id: '94599',
    name: 'Cape Byron',
    lat: -28.6387,
    lon: 153.6363,
    url: `${BOM_PAGE}.94599.shtml`,
  },
} satisfies Record<string, Station>;

/** Model grid extent; roughly 10 km offshore of Cape Byron. */
export const GRID = {
  south: -28.95,
  north: -28.55,
  west: 153.5,
  east: 153.76,
  cellKm: 0.2,
};

export const MAP_VIEW = { center: [-28.74, 153.62] as [number, number], zoom: 11 };

export interface Spot {
  name: string;
  lat: number;
  lon: number;
}

/** Approximate positions; snapped to the nearest water cell at runtime. */
export const SPOTS: Spot[] = [
  { name: 'Tyagarah', lat: -28.6044, lon: 153.5795 },
  { name: 'Belongil', lat: -28.6145, lon: 153.5925 },
  { name: 'Main Beach', lat: -28.6385, lon: 153.6149 },
  { name: 'Clarkes', lat: -28.6385, lon: 153.6215 },
  { name: 'The Pass', lat: -28.6368, lon: 153.6275 },
  { name: 'Wategos', lat: -28.6345, lon: 153.6345 },
  { name: 'Cosy Corner', lat: -28.6425, lon: 153.6375 },
  { name: 'Tallow', lat: -28.6695, lon: 153.6265 },
  { name: 'Broken Head', lat: -28.7025, lon: 153.6195 },
  { name: 'Seven Mile (north)', lat: -28.745, lon: 153.6105 },
  { name: 'Lennox (town)', lat: -28.79, lon: 153.6 },
  { name: 'Lennox Point', lat: -28.8045, lon: 153.6065 },
  { name: 'Boulder Beach', lat: -28.8186, lon: 153.6085 },
  { name: 'Sharpes', lat: -28.8375, lon: 153.608 },
  { name: 'Angels', lat: -28.8493, lon: 153.6045 },
  { name: 'Shelly Beach', lat: -28.8624, lon: 153.5975 },
  { name: 'Lighthouse / North Wall', lat: -28.871, lon: 153.5935 },
  { name: 'South Wall', lat: -28.882, lon: 153.5935 },
];

export interface ModelParams {
  /** Wind below this (km/h) leaves the surface glassy regardless of direction. */
  calmKmh: number;
  /** Wind at which fully exposed water is considered blown out (km/h). */
  messyKmh: number;
  /** 0–1: how much of the gust excess over the mean speed counts. */
  gustWeight: number;
  /** 0–1: how completely land upwind (headlands, coast) blocks the wind. */
  shelter: number;
  /** Distance downwind of land (km) over which chop rebuilds to ~63% of open water. */
  recoveryKm: number;
  /** Half-width (degrees) of the upwind cone used to look for sheltering land. */
  coneDeg: number;
  /** Hours for chop to build towards a messier state (e-folding time). */
  buildHours: number;
  /** Hours for leftover chop to settle once the wind eases or turns offshore. */
  settleHours: number;
}

export const DEFAULT_PARAMS: ModelParams = {
  calmKmh: 8,
  messyKmh: 30,
  gustWeight: 0.3,
  shelter: 0.85,
  recoveryKm: 4,
  coneDeg: 20,
  buildHours: 1.5,
  settleHours: 5,
};
