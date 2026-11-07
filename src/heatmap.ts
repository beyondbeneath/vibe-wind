import L from 'leaflet';
import { RAMP_LUT } from './colors';
import type { Grid } from './grid';

/** Renders one frame of the chop field as a smoothly upscaled image overlay. */
export class HeatmapLayer {
  readonly layer: L.ImageOverlay;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private image: ImageData;
  /** Per water cell alpha, feathered towards the open-sea edges of the model grid. */
  private alpha: Uint8Array;

  constructor(private grid: Grid, opacity: number) {
    const feather = 12;
    this.alpha = Uint8Array.from(grid.water, (idx) => {
      const i = idx % grid.nx;
      const j = (idx / grid.nx) | 0;
      const edge = Math.min(j, grid.ny - 1 - j, grid.nx - 1 - i);
      return Math.round(255 * Math.min(1, edge / feather));
    });
    this.canvas.width = grid.nx;
    this.canvas.height = grid.ny;
    this.ctx = this.canvas.getContext('2d')!;
    this.image = this.ctx.createImageData(grid.nx, grid.ny);
    const bounds = L.latLngBounds([grid.south, grid.west], [grid.north, grid.east]);
    this.layer = L.imageOverlay(this.canvas.toDataURL(), bounds, {
      opacity,
      className: 'heatmap-overlay',
      interactive: false,
    });
  }

  render(values: Uint8Array, offset: number) {
    const { water } = this.grid;
    const px = this.image.data;
    px.fill(0);
    for (let k = 0; k < water.length; k++) {
      const [r, g, b] = RAMP_LUT[values[offset + k]];
      const o = water[k] * 4;
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = this.alpha[k];
    }
    this.ctx.putImageData(this.image, 0, 0);
    this.layer.setUrl(this.canvas.toDataURL());
  }
}
