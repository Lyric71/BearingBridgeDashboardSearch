// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';

// Dev-only SSE endpoint (src/server/refresh.ts) for re-running SERP rankings.
// It's `prerender = false`, so keeping it under src/pages/ would force the
// whole build to require a server adapter. Instead we inject it as a route
// only under `astro dev`, so `astro build` stays fully static (no adapter).
const devRefreshRoute = {
  name: 'dev-refresh-route',
  hooks: {
    'astro:config:setup': ({ command, injectRoute }) => {
      if (command === 'dev') {
        injectRoute({
          pattern: '/seo/refresh',
          entrypoint: './src/server/refresh.ts',
          prerender: false,
        });
      }
    },
  },
};

// https://astro.build/config
export default defineConfig({
  integrations: [react(), devRefreshRoute],
  server: {
    host: "127.0.0.1",
  },
  vite: {
    plugins: [tailwindcss()]
  }
});