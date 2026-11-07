import { defineConfig, type ProxyOptions } from 'vite';

// BOM blocks cross-origin requests and non-browser user agents, so the
// observation feeds are proxied through the dev/preview server.
const bomProxy: Record<string, ProxyOptions> = {
  '/bom': {
    target: 'https://www.bom.gov.au',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/bom/, ''),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      Referer: 'https://www.bom.gov.au/',
    },
  },
};

export default defineConfig({
  server: { proxy: bomProxy },
  preview: { proxy: bomProxy },
});
