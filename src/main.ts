import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import coastline from './data/coastline.json';
import { degToCompass, loadStation, type StationSeries } from './bom';
import { computeExposure, exposureAt, runModel, waterWeights, windFactor, type ChopResult } from './chop';
import { chopLabel, rampCss, rampGradientCss } from './colors';
import { DEFAULT_PARAMS, MAP_VIEW, SPOTS, STATIONS, type ModelParams, type Station } from './config';
import { buildGrid, cellCenter, nearestWater, offshoreBearing, type Grid, type Ring } from './grid';
import { HeatmapLayer } from './heatmap';
import { WindParticles } from './particles';
import { buildFrames, byronWeight, toVector, windAt, type WindFrame, type WindSample } from './wind';

// ---------- state ----------

interface SliderDef {
  key: keyof ModelParams;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  help: string;
  /** Changing this requires recomputing the exposure tables. */
  geometric?: boolean;
}

const SLIDERS: SliderDef[] = [
  { key: 'calmKmh', label: 'Glassy below', min: 0, max: 20, step: 1, unit: 'km/h', help: 'Wind lighter than this leaves the surface clean from any direction.' },
  { key: 'messyKmh', label: 'Blown out at', min: 12, max: 50, step: 1, unit: 'km/h', help: 'Wind speed at which fully exposed water is rated messiest.' },
  { key: 'gustWeight', label: 'Gust influence', min: 0, max: 1, step: 0.05, unit: '', help: '0 = use mean wind only, 1 = use gust speed.' },
  { key: 'shelter', label: 'Land / headland shelter', min: 0, max: 1, step: 0.05, unit: '', help: 'How completely land upwind (the coast itself, or a headland like Lennox or Cape Byron) blocks the wind. 0 ignores land entirely.', geometric: true },
  { key: 'recoveryKm', label: 'Shelter reach', min: 0.5, max: 15, step: 0.5, unit: 'km', help: 'Distance downwind of land over which the wind regains its bite. Larger = clean water extends further out / further behind headlands.', geometric: true },
  { key: 'coneDeg', label: 'Wind spread', min: 0, max: 45, step: 5, unit: '±°', help: 'Upwind cone checked for land. Wider = narrow headlands only partly shelter the water behind them.', geometric: true },
  { key: 'buildHours', label: 'Chop build-up', min: 0, max: 6, step: 0.25, unit: 'h', help: 'How fast the surface gets messy once wind picks up (time to ~63% of the way).' },
  { key: 'settleHours', label: 'Clean-up time', min: 0, max: 24, step: 0.5, unit: 'h', help: 'How long leftover chop takes to settle after the wind eases or swings offshore (time to ~63% cleaned up). 0 = instant.' },
];

const PARAMS_KEY = 'surface-params-v1';
function loadParams(): ModelParams {
  try {
    return { ...DEFAULT_PARAMS, ...JSON.parse(localStorage.getItem(PARAMS_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_PARAMS };
  }
}

const state = {
  params: loadParams(),
  frameIdx: 0,
  showHeatmap: true,
  showWind: true,
  showSpots: true,
  memory: true,
  opacity: 0.7,
  streaks: 0.4,
  playing: 0 as number,
  mode: 'live' as 'live' | 'sim',
  sim: { dirFrom: 270, speedKmh: 20, gustKmh: 26 },
};

// ---------- DOM ----------

const app = document.getElementById('app')!;
app.innerHTML = `
  <aside class="panel" id="panel">
    <header>
      <h1>Ballina → Byron surface</h1>
      <div class="status" id="status">Loading BOM observations…</div>
    </header>
    <div class="mode-switch" role="tablist">
      <button type="button" data-mode="live" class="active">Live</button>
      <button type="button" data-mode="sim">Simulated</button>
    </div>
    <section class="readings" id="readings"></section>
    <section class="sim-controls" id="sim-controls" hidden>
      <label class="slider"><span class="slider-label">Wind from</span><output id="sim-dir-out"></output>
        <input type="range" id="sim-dir" min="0" max="355" step="5"></label>
      <label class="slider"><span class="slider-label">Speed</span><output id="sim-speed-out"></output>
        <input type="range" id="sim-speed" min="0" max="60" step="1"></label>
      <label class="slider"><span class="slider-label">Gusts</span><output id="sim-gust-out"></output>
        <input type="range" id="sim-gust" min="0" max="80" step="1"></label>
      <small class="muted">Same wind at both stations, blowing steadily long enough for the surface to settle.</small>
    </section>
    <section>
      <div class="legend">
        <div class="legend-bar" style="background:${rampGradientCss()}"></div>
        <div class="legend-labels"><span>Clean / offshore</span><span>Bumpy</span><span>Blown out</span></div>
      </div>
    </section>
    <section class="toggles">
      <label><input type="checkbox" id="t-heat" checked> Surface heatmap</label>
      <label><input type="checkbox" id="t-wind" checked> Wind streaks</label>
      <label><input type="checkbox" id="t-spots" checked> Surf spots</label>
      <label title="Include the time it takes the surface to build up / clean up"><input type="checkbox" id="t-memory" checked> Account for settling time</label>
      <label class="inline-range">Heatmap opacity <input type="range" id="t-opacity" min="0.1" max="1" step="0.05" value="${state.opacity}"></label>
      <label class="inline-range" title="Number, speed and brightness of the wind streaks">Streak intensity <input type="range" id="t-streaks" min="0.1" max="1" step="0.05" value="${state.streaks}"></label>
    </section>
    <details class="spots" open>
      <summary>Spots (north → south)</summary>
      <ul id="spot-list"></ul>
    </details>
    <details class="tuning">
      <summary>Model tuning</summary>
      <div id="sliders"></div>
      <button id="reset" type="button">Reset defaults</button>
    </details>
    <details class="about">
      <summary>How it works</summary>
      <p>Wind comes only from the BOM stations at <a href="${STATIONS.ballina.url}" target="_blank" rel="noreferrer">Ballina Airport</a> and <a href="${STATIONS.byron.url}" target="_blank" rel="noreferrer">Cape Byron</a>. Between them, speed and direction blend smoothly along the coast; south of Ballina it's pure Ballina, north of Byron pure Byron.</p>
      <p>For each patch of water the model looks <em>upwind</em> for land. Land close upwind means the wind has come off the coast or around a headland, so the water is sheltered (offshore = clean). Open ocean upwind means the wind has fetch to roughen the surface (onshore = messy). Cross-shore winds land in between, and headlands give partial shelter downwind of them.</p>
      <p>Messiness = wind strength × exposure. With <em>settling time</em> on, the surface builds up quickly but takes hours to clean up, so a morning offshore after an overnight onshore still shows leftover chop.</p>
      <p>Rough guide only: ignores swell, tide, sandbanks and local wind effects. Coastline © OpenStreetMap contributors.</p>
    </details>
  </aside>
  <div class="timebar" id="timebar">
    <button id="play" type="button" aria-label="Play">▶</button>
    <div class="time-wrap">
      <input type="range" id="time" min="0" max="0" value="0">
      <div class="time-ticks" id="ticks"></div>
    </div>
    <div class="time-label" id="time-label">–</div>
    <button id="latest" type="button">Latest</button>
  </div>
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- map ----------

const map = L.map('map', { zoomControl: false, preferCanvas: true }).setView(MAP_VIEW.center, MAP_VIEW.zoom);
L.control.zoom({ position: 'bottomright' }).addTo(map);

const esri = (service: string, maxNativeZoom: number) =>
  L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`, {
    attribution: 'Tiles &copy; Esri',
    maxZoom: 18,
    maxNativeZoom,
  });
const basemaps: Record<string, L.TileLayer> = {
  Dark: esri('Canvas/World_Dark_Gray_Base', 16),
  Light: esri('Canvas/World_Light_Gray_Base', 16),
  OpenStreetMap: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 18,
  }),
  Satellite: esri('World_Imagery', 18),
};
basemaps.Dark.addTo(map);
L.control.layers(basemaps, undefined, { position: 'bottomright' }).addTo(map);

// ---------- model setup ----------

const grid: Grid = buildGrid([coastline.mainland, ...coastline.islands] as Ring[]);
const weights = waterWeights(grid);
const heatmap = new HeatmapLayer(grid, state.opacity);
heatmap.layer.addTo(map);

interface SpotInfo {
  name: string;
  idx: number;
  k: number;
  lat: number;
  lon: number;
  weight: number;
  offshore: number;
  marker: L.CircleMarker;
  li: HTMLLIElement;
}

const spotLayer = L.layerGroup().addTo(map);
const spotList = $<HTMLUListElement>('spot-list');
const spots: SpotInfo[] = SPOTS.flatMap((s) => {
  const idx = nearestWater(grid, s.lat, s.lon);
  if (idx < 0) return [];
  const k = grid.waterPos[idx];
  const [lat, lon] = cellCenter(grid, idx);
  const marker = L.circleMarker([s.lat, s.lon], { radius: 7, weight: 2, color: '#fff', fillOpacity: 1 })
    .bindTooltip(s.name, { direction: 'right', offset: [8, 0] })
    .addTo(spotLayer);
  const li = document.createElement('li');
  li.addEventListener('click', () => {
    map.setView([s.lat, s.lon], Math.max(map.getZoom(), 14));
    marker.openPopup();
  });
  spotList.appendChild(li);
  return [{ name: s.name, idx, k, lat, lon, weight: byronWeight(lat, lon), offshore: offshoreBearing(grid, k), marker, li }];
});

function relation(dirFrom: number, offshore: number): string {
  if (Number.isNaN(dirFrom) || Number.isNaN(offshore)) return 'calm';
  const d = Math.abs(((dirFrom - offshore + 540) % 360) - 180);
  if (d <= 30) return 'offshore';
  if (d <= 65) return 'cross-off';
  if (d <= 115) return 'cross-shore';
  if (d <= 150) return 'cross-on';
  return 'onshore';
}

const stationIcon = (station: Station, w: WindSample) => {
  const calm = Number.isNaN(w.dirFrom) || w.speedKmh === 0;
  const rot = calm ? 0 : (w.dirFrom + 180) % 360;
  return L.divIcon({
    className: 'station-icon',
    iconSize: [0, 0],
    html: `<div class="station">
      <svg viewBox="-12 -12 24 24" width="30" height="30" style="transform:rotate(${rot}deg)">
        ${calm ? '<circle r="5" fill="none" stroke="currentColor" stroke-width="2.5"/>' : '<path d="M0,-10 L7,6 L0,2 L-7,6 Z" fill="currentColor"/>'}
      </svg>
      <div class="station-text"><b>${station.name}</b><br>${calm ? 'Calm' : `${degToCompass(w.dirFrom)} ${Math.round(w.speedKmh)}`}<small> gust ${Math.round(w.gustKmh)} km/h</small></div>
    </div>`,
  });
};
const stationMarkers = {
  ballina: L.marker([STATIONS.ballina.lat, STATIONS.ballina.lon], { interactive: false }).addTo(map),
  byron: L.marker([STATIONS.byron.lat, STATIONS.byron.lon], { interactive: false }).addTo(map),
};

// ---------- data + model run ----------

/** Frames currently driving the display: the live record, or one simulated frame. */
let frames: WindFrame[] = [];
let liveFrames: WindFrame[] = [];
let series: StationSeries[] = [];

function simFrame(): WindFrame {
  const { dirFrom, speedKmh, gustKmh } = state.sim;
  const s: WindSample = { dirFrom: speedKmh === 0 ? NaN : dirFrom, speedKmh, gustKmh: Math.max(gustKmh, speedKmh) };
  return { t: Date.now(), ballina: s, byron: s };
}
let exposure: Float32Array | null = null;
let result: ChopResult | null = null;

function recompute(geometric: boolean) {
  if (!frames.length) return;
  const t0 = performance.now();
  if (geometric || !exposure) exposure = computeExposure(grid, state.params);
  result = runModel(grid, frames, weights, exposure, state.params);
  console.debug(`model run ${Math.round(performance.now() - t0)} ms`);
  render();
}

let windLookupFrame: WindFrame | null = null;
const particles = new WindParticles(map, (lat, lon) => {
  if (!windLookupFrame) return null;
  const w = windAt(windLookupFrame, byronWeight(lat, lon));
  if (Number.isNaN(w.dirFrom)) return [0, 0];
  const [ex, ny] = toVector(w.dirFrom);
  return [ex * w.speedKmh, ny * w.speedKmh];
}, state.streaks);
particles.setEnabled(state.showWind);

const timeFmt = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'Australia/Sydney',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
const dayFmt = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short' });
const hourFmt = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', hourCycle: 'h23' });

const valueAt = (frameIdx: number, k: number) => {
  if (!result) return 0;
  const arr = state.memory ? result.chop : result.target;
  return arr[frameIdx * result.nWater + k] / 255;
};

function render() {
  const frame = frames[state.frameIdx];
  if (!frame || !result) return;
  windLookupFrame = frame;

  if (state.showHeatmap) heatmap.render(state.memory ? result.chop : result.target, state.frameIdx * result.nWater);

  stationMarkers.ballina.setIcon(stationIcon(STATIONS.ballina, frame.ballina));
  stationMarkers.byron.setIcon(stationIcon(STATIONS.byron, frame.byron));

  for (const s of spots) {
    const v = valueAt(state.frameIdx, s.k);
    const w = windAt(frame, s.weight);
    const rel = relation(w.dirFrom, s.offshore);
    const dirText = Number.isNaN(w.dirFrom) ? 'calm' : `${degToCompass(w.dirFrom)} ${Math.round(w.speedKmh)} km/h`;
    s.marker.setStyle({ fillColor: rampCss(v) });
    s.marker.bindPopup(
      `<b>${s.name}</b><br>${chopLabel(v)} <span class="muted">(${Math.round(v * 100)}%)</span><br>Wind ${dirText}, ${rel}` +
        (Number.isNaN(s.offshore) ? '' : `<br><span class="muted">Offshore here ≈ ${degToCompass(s.offshore)} wind</span>`),
    );
    s.li.innerHTML = `<span class="chip" style="background:${rampCss(v)}"></span><span class="spot-name">${s.name}</span><span class="spot-meta">${chopLabel(v)} · ${rel}</span>`;
  }

  const fmtWind = (w: WindSample) =>
    Number.isNaN(w.dirFrom) || w.speedKmh === 0
      ? 'Calm'
      : `<b>${degToCompass(w.dirFrom)}</b> ${Math.round(w.speedKmh)} km/h <span class="muted">gust ${Math.round(w.gustKmh)}</span>`;
  $('readings').innerHTML =
    state.mode === 'sim'
      ? `<div><span>Simulated</span>${fmtWind(frame.ballina)}</div>`
      : `<div><span>Ballina</span>${fmtWind(frame.ballina)}</div>
         <div><span>Cape Byron</span>${fmtWind(frame.byron)}</div>`;
  if (state.mode === 'sim') return;

  const spinUpH = (frame.t - frames[0].t) / 36e5;
  const spinning = state.memory && spinUpH < state.params.settleHours * 1.5;
  $('time-label').innerHTML = `${timeFmt.format(frame.t)}${state.frameIdx === frames.length - 1 ? ' <span class="badge">latest</span>' : ''}${
    spinning ? ' <span class="badge warn" title="Too early in the record to know what the sea did beforehand; settling memory is still warming up">spin-up</span>' : ''
  }`;
}

// Click anywhere on the water for a local readout.
map.on('click', (e: L.LeafletMouseEvent) => {
  const frame = frames[state.frameIdx];
  if (!frame || !result || !exposure) return;
  const idx = nearestWater(grid, e.latlng.lat, e.latlng.lng, 1);
  if (idx < 0) return;
  const k = grid.waterPos[idx];
  const w = windAt(frame, weights[k]);
  const v = valueAt(state.frameIdx, k);
  const exp = exposureAt(exposure, result.nWater, k, w.dirFrom);
  const wf = windFactor(w, state.params);
  L.popup()
    .setLatLng(e.latlng)
    .setContent(
      `<b>${chopLabel(v)}</b> <span class="muted">(${Math.round(v * 100)}%)</span><br>` +
        `Wind ${Number.isNaN(w.dirFrom) ? 'calm' : `${degToCompass(w.dirFrom)} ${Math.round(w.speedKmh)} km/h`}<br>` +
        `<span class="muted">Wind strength ${Math.round(wf * 100)}% · exposure ${Math.round(exp * 100)}%</span>`,
    )
    .openOn(map);
});

// ---------- controls ----------

const slidersEl = $('sliders');
for (const def of SLIDERS) {
  const row = document.createElement('label');
  row.className = 'slider';
  row.title = def.help;
  row.innerHTML = `<span class="slider-label">${def.label}</span><output></output>
    <input type="range" min="${def.min}" max="${def.max}" step="${def.step}">
    <small>${def.help}</small>`;
  const input = row.querySelector('input')!;
  const out = row.querySelector('output')!;
  const sync = () => {
    input.value = String(state.params[def.key]);
    out.textContent = `${state.params[def.key]}${def.unit ? ` ${def.unit}` : ''}`;
  };
  sync();
  let pending = 0;
  input.addEventListener('input', () => {
    state.params[def.key] = Number(input.value);
    out.textContent = `${input.value}${def.unit ? ` ${def.unit}` : ''}`;
    localStorage.setItem(PARAMS_KEY, JSON.stringify(state.params));
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => recompute(!!def.geometric));
  });
  row.addEventListener('sync', sync);
  slidersEl.appendChild(row);
}

$('reset').addEventListener('click', () => {
  state.params = { ...DEFAULT_PARAMS };
  localStorage.removeItem(PARAMS_KEY);
  slidersEl.querySelectorAll('.slider').forEach((el) => el.dispatchEvent(new Event('sync')));
  recompute(true);
});

const bindToggle = (id: string, fn: (on: boolean) => void) =>
  $<HTMLInputElement>(id).addEventListener('change', (e) => fn((e.target as HTMLInputElement).checked));

bindToggle('t-heat', (on) => {
  state.showHeatmap = on;
  if (on) heatmap.layer.addTo(map);
  else heatmap.layer.remove();
  render();
});
bindToggle('t-wind', (on) => {
  state.showWind = on;
  particles.setEnabled(on);
});
bindToggle('t-spots', (on) => {
  state.showSpots = on;
  if (on) spotLayer.addTo(map);
  else spotLayer.remove();
});
bindToggle('t-memory', (on) => {
  state.memory = on;
  render();
});
$<HTMLInputElement>('t-opacity').addEventListener('input', (e) => {
  state.opacity = Number((e.target as HTMLInputElement).value);
  heatmap.layer.setOpacity(state.opacity);
});
$<HTMLInputElement>('t-streaks').addEventListener('input', (e) => {
  state.streaks = Number((e.target as HTMLInputElement).value);
  particles.setIntensity(state.streaks);
});

// ---------- live / simulated mode ----------

const simInputs = {
  dirFrom: $<HTMLInputElement>('sim-dir'),
  speedKmh: $<HTMLInputElement>('sim-speed'),
  gustKmh: $<HTMLInputElement>('sim-gust'),
};

function syncSimOutputs() {
  const { dirFrom, speedKmh, gustKmh } = state.sim;
  $('sim-dir-out').textContent = `${degToCompass(dirFrom)} (${dirFrom}°)`;
  $('sim-speed-out').textContent = `${speedKmh} km/h`;
  $('sim-gust-out').textContent = `${Math.max(gustKmh, speedKmh)} km/h`;
}

for (const [key, input] of Object.entries(simInputs) as [keyof typeof state.sim, HTMLInputElement][]) {
  input.value = String(state.sim[key]);
  input.addEventListener('input', () => {
    state.sim[key] = Number(input.value);
    syncSimOutputs();
    if (state.mode === 'sim') {
      frames = [simFrame()];
      recompute(false);
    }
  });
}
syncSimOutputs();

function setMode(mode: 'live' | 'sim') {
  state.mode = mode;
  stopPlaying();
  document.querySelectorAll<HTMLButtonElement>('.mode-switch button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('sim-controls').hidden = mode !== 'sim';
  $('timebar').hidden = mode === 'sim';
  if (mode === 'sim') {
    frames = [simFrame()];
    state.frameIdx = 0;
  } else {
    frames = liveFrames;
    setFrame(frames.length - 1);
  }
  recompute(false);
}

document.querySelectorAll<HTMLButtonElement>('.mode-switch button').forEach((b) =>
  b.addEventListener('click', () => setMode(b.dataset.mode as 'live' | 'sim')),
);

const timeInput = $<HTMLInputElement>('time');
const playBtn = $<HTMLButtonElement>('play');

function setFrame(i: number) {
  state.frameIdx = Math.max(0, Math.min(frames.length - 1, i));
  timeInput.value = String(state.frameIdx);
  render();
}

function stopPlaying() {
  clearInterval(state.playing);
  state.playing = 0;
  playBtn.textContent = '▶';
}

timeInput.addEventListener('input', () => {
  stopPlaying();
  setFrame(Number(timeInput.value));
});
$('latest').addEventListener('click', () => {
  stopPlaying();
  setFrame(frames.length - 1);
});
playBtn.addEventListener('click', () => {
  if (state.playing) return stopPlaying();
  if (state.frameIdx >= frames.length - 1) setFrame(0);
  playBtn.textContent = '❚❚';
  state.playing = window.setInterval(() => {
    if (state.frameIdx >= frames.length - 1) return stopPlaying();
    setFrame(state.frameIdx + 1);
  }, 220);
});
document.addEventListener('keydown', (e) => {
  if (state.mode !== 'live') return;
  if ((e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
  if (e.key === 'ArrowLeft') setFrame(state.frameIdx - 1);
  else if (e.key === 'ArrowRight') setFrame(state.frameIdx + 1);
  else return;
  stopPlaying();
  e.preventDefault();
});

function renderTicks() {
  const ticks = $('ticks');
  ticks.innerHTML = '';
  if (liveFrames.length < 2) return;
  const span = liveFrames.length - 1;
  liveFrames.forEach((f, i) => {
    const hour = Number(hourFmt.format(f.t));
    const minute = new Date(f.t).getUTCMinutes();
    if (minute !== 0 || (hour !== 0 && hour !== 12)) return;
    const el = document.createElement('span');
    el.className = hour === 0 ? 'tick day' : 'tick';
    el.style.left = `${(i / span) * 100}%`;
    if (hour === 0) el.textContent = dayFmt.format(f.t);
    ticks.appendChild(el);
  });
}

// ---------- boot ----------

async function boot() {
  try {
    series = await Promise.all([loadStation(STATIONS.ballina), loadStation(STATIONS.byron)]);
  } catch (err) {
    $('status').textContent = `Could not load observations: ${(err as Error).message}`;
    $('status').classList.add('error');
    return;
  }
  liveFrames = buildFrames(series[0].observations, series[1].observations);
  if (state.mode === 'live') frames = liveFrames;
  if (!liveFrames.length) {
    $('status').textContent = 'No wind observations available.';
    return;
  }
  const live = series.every((s) => s.source === 'live');
  const hours = Math.round((liveFrames.at(-1)!.t - liveFrames[0].t) / 36e5);
  $('status').innerHTML = `${live ? '<span class="dot live"></span>Live BOM data' : '<span class="dot sample"></span>Offline sample data'} · ${hours} h history`;
  timeInput.max = String(liveFrames.length - 1);
  renderTicks();
  if (state.mode === 'live') {
    state.frameIdx = liveFrames.length - 1;
    timeInput.value = String(state.frameIdx);
  }
  recompute(true);
}

boot();

// Refresh live data every 10 minutes, staying on "latest" if the user was there.
setInterval(async () => {
  if (state.playing) return;
  try {
    const fresh = await Promise.all([loadStation(STATIONS.ballina), loadStation(STATIONS.byron)]);
    if (fresh.some((s) => s.source !== 'live')) return;
    series = fresh;
    const atLatest = state.frameIdx === liveFrames.length - 1;
    const prevT = liveFrames[state.frameIdx]?.t;
    liveFrames = buildFrames(series[0].observations, series[1].observations);
    timeInput.max = String(liveFrames.length - 1);
    renderTicks();
    if (state.mode !== 'live') return;
    frames = liveFrames;
    state.frameIdx = atLatest ? frames.length - 1 : Math.max(0, frames.findIndex((f) => f.t === prevT));
    timeInput.value = String(state.frameIdx);
    recompute(false);
  } catch {
    /* keep showing what we have */
  }
}, 10 * 60 * 1000);
