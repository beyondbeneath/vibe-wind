// Builds src/data/coastline.json from OpenStreetMap natural=coastline ways.
//   node scripts/build-coastline.mjs          # use cached data/raw/osm-coastline.json
//   node scripts/build-coastline.mjs --fetch  # re-download from Overpass first
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const RAW = 'data/raw/osm-coastline.json';
const OUT = 'src/data/coastline.json';
const BBOX = '-29.0,153.40,-28.50,153.75';
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function fetchRaw() {
  const query = `[out:json][timeout:90];way["natural"="coastline"](${BBOX});out geom;`;
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        headers: { 'User-Agent': 'surface-conditions/0.1' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      JSON.parse(text);
      await mkdir('data/raw', { recursive: true });
      await writeFile(RAW, text);
      console.log(`Fetched coastline from ${url}`);
      return;
    } catch (err) {
      console.warn(`${url} failed: ${err.message}`);
    }
  }
  throw new Error('All Overpass mirrors failed');
}

if (process.argv.includes('--fetch') || !existsSync(RAW)) await fetchRaw();

const ways = JSON.parse(await readFile(RAW, 'utf8')).elements.map((e) => ({
  nodes: e.nodes,
  coords: e.geometry.map((g) => [+g.lon.toFixed(6), +g.lat.toFixed(6)]),
}));

// Stitch ways end-to-start into chains (OSM coastline has land on the left).
const byStart = new Map(ways.map((w) => [w.nodes[0], w]));
const used = new Set();
const chains = [];
for (const w of ways) {
  if (used.has(w)) continue;
  // Walk back to the head of this chain.
  let head = w;
  const seen = new Set([head]);
  for (;;) {
    const prev = ways.find((p) => !seen.has(p) && p.nodes.at(-1) === head.nodes[0] && !used.has(p));
    if (!prev || prev === w) break;
    seen.add(prev);
    head = prev;
  }
  const coords = [...head.coords];
  const first = head.nodes[0];
  used.add(head);
  let cur = head;
  for (;;) {
    const next = byStart.get(cur.nodes.at(-1));
    if (!next || used.has(next)) break;
    used.add(next);
    coords.push(...next.coords.slice(1));
    cur = next;
  }
  chains.push({ coords, closed: cur.nodes.at(-1) === first });
}

const islands = chains.filter((c) => c.closed).map((c) => c.coords);
const open = chains.filter((c) => !c.closed);
if (open.length !== 1) {
  throw new Error(`Expected one open mainland chain, got ${open.length}`);
}

// Close the mainland chain far to the west so the polygon covers all land.
const main = open[0].coords;
const west = 152.5;
const mainland = [...main, [west, main.at(-1)[1]], [west, main[0][1]]];

await mkdir('src/data', { recursive: true });
await writeFile(
  OUT,
  JSON.stringify({
    source: '© OpenStreetMap contributors (ODbL), natural=coastline',
    mainland,
    islands,
  }),
);
console.log(`Wrote ${OUT}: mainland ${mainland.length} pts, ${islands.length} islands`);
