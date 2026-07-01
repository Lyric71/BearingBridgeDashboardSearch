// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';

// https://astro.build/config
// SSR ("server") so pages/API routes read & write the Supabase DB at request
// time. The DB is the single source of truth; data survives deploys instead of
// living in per-browser localStorage. Vercel adapter hosts the SSR functions.
export default defineConfig({
  output: 'server',
  // maxDuration (seconds) applies to the SSR functions. The /seo/refresh SERP
  // refresh batches DataForSEO calls but can still run tens of seconds, so give
  // the serverless functions headroom above Vercel's low default.
  adapter: vercel({ maxDuration: 60 }),
  integrations: [react()],
  server: {
    host: "127.0.0.1",
  },
  vite: {
    plugins: [tailwindcss()]
  }
});