import L from 'leaflet';

/** Returns the wind at a location as [east, north] km/h, or null if unknown. */
export type WindLookup = (lat: number, lon: number) => [number, number] | null;

interface Particle {
  /** Recent positions, oldest first; the last entry is the head. */
  xs: number[];
  ys: number[];
  age: number;
  maxAge: number;
}

/** At full intensity: one streak per this many px², moving this many px per frame per km/h. */
const DENSITY_PX2 = 1800;
const MAX_PX_PER_KMH_FRAME = 0.08;
/** Trail length in frames. */
const TRAIL = 20;
/** Trail segments are batched into this many opacity steps. */
const ALPHA_STEPS = 10;

/**
 * Windy-style animated wind streaks drawn on a canvas in a custom map pane.
 * Each streak keeps its own short position history and the canvas is fully
 * cleared every frame; fading the previous frame instead leaves permanent
 * ghost trails because 8-bit alpha stops decreasing at low values.
 */
export class WindParticles {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private particles: Particle[] = [];
  private raf = 0;
  private moving = false;
  private enabled = false;

  /** 0–1: scales streak count, speed and brightness together. */
  constructor(private map: L.Map, private wind: WindLookup, private intensity = 0.4) {
    const pane = map.getPane('particles') ?? map.createPane('particles');
    pane.style.zIndex = '450';
    pane.style.pointerEvents = 'none';
    this.canvas.className = 'particle-canvas';
    pane.appendChild(this.canvas);
    map.on('movestart zoomstart', () => {
      this.moving = true;
      this.clear();
    });
    map.on('moveend zoomend resize', () => {
      this.moving = false;
      this.reset();
    });
    this.reset();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.canvas.style.display = on ? '' : 'none';
    cancelAnimationFrame(this.raf);
    if (on) this.loop();
    else this.clear();
  }

  setIntensity(v: number) {
    this.intensity = v;
    this.reset();
  }

  private reset() {
    const size = this.map.getSize();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = size.x * dpr;
    this.canvas.height = size.y * dpr;
    this.canvas.style.width = `${size.x}px`;
    this.canvas.style.height = `${size.y}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    L.DomUtil.setPosition(this.canvas, this.map.containerPointToLayerPoint([0, 0]));
    const count = Math.round(((size.x * size.y) / DENSITY_PX2) * this.intensity);
    this.particles = Array.from({ length: count }, () => this.spawn(size, true));
  }

  private spawn(size: L.Point, randomAge = false): Particle {
    const maxAge = 60 + Math.random() * 80;
    return {
      xs: [Math.random() * size.x],
      ys: [Math.random() * size.y],
      age: randomAge ? Math.random() * maxAge : 0,
      maxAge,
    };
  }

  private clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private loop = () => {
    if (!this.enabled) return;
    if (!this.moving) {
      this.advance();
      this.draw();
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private advance() {
    const { map } = this;
    const size = map.getSize();
    const pxPerKmh = MAX_PX_PER_KMH_FRAME * (0.35 + 0.65 * this.intensity);
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const x = p.xs[p.xs.length - 1];
      const y = p.ys[p.ys.length - 1];
      const ll = map.containerPointToLatLng([x, y]);
      const v = this.wind(ll.lat, ll.lng);
      const nx = x + (v ? v[0] * pxPerKmh : 0);
      const ny = y - (v ? v[1] * pxPerKmh : 0);
      if (++p.age > p.maxAge || nx < 0 || ny < 0 || nx > size.x || ny > size.y) {
        this.particles[i] = this.spawn(size);
        continue;
      }
      p.xs.push(nx);
      p.ys.push(ny);
      if (p.xs.length > TRAIL) {
        p.xs.shift();
        p.ys.shift();
      }
    }
  }

  private draw() {
    const { ctx } = this;
    const size = this.map.getSize();
    ctx.clearRect(0, 0, size.x, size.y);
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    const maxAlpha = 0.3 + 0.5 * this.intensity;
    const segsPerStep = (TRAIL - 1) / ALPHA_STEPS;
    // Segment k counts back from the head (k = 0 is newest, brightest).
    for (let step = 0; step < ALPHA_STEPS; step++) {
      const k0 = Math.round(step * segsPerStep);
      const k1 = Math.round((step + 1) * segsPerStep);
      ctx.strokeStyle = `rgba(255,255,255,${maxAlpha * (1 - step / ALPHA_STEPS)})`;
      ctx.beginPath();
      for (const p of this.particles) {
        const n = p.xs.length;
        for (let k = k0; k < k1 && k + 1 < n; k++) {
          ctx.moveTo(p.xs[n - 2 - k], p.ys[n - 2 - k]);
          ctx.lineTo(p.xs[n - 1 - k], p.ys[n - 1 - k]);
        }
      }
      ctx.stroke();
    }
  }
}
