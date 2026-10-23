/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const REPO = 'Sunset-tracker';
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Two bundles from one codebase: GitHub Pages lives under /<REPO>/, the Capacitor WebView serves from /.
export default defineConfig(({ mode }) => {
  const base = mode === 'pages' ? `/${REPO}/` : '/';
  const isAndroid = mode === 'android';
  return {
    base,
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __BUILD_TARGET__: JSON.stringify(isAndroid ? 'android' : 'web'),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    plugins: [
      react(),
      VitePWA({
        disable: isAndroid,
        registerType: 'autoUpdate',
        includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon.png'],
        manifest: {
          name: 'Glowcast — sunset & sunrise forecast',
          short_name: 'Glowcast',
          description: 'Sunset and sunrise quality forecasts for landscape photographers.',
          theme_color: '#14121f',
          background_color: '#14121f',
          display: 'standalone',
          orientation: 'any',
          start_url: base,
          scope: base,
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // Precomputed map grids change every 3 h; fetch fresh but fall back to the last copy offline.
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.includes('/maps/'),
              handler: 'NetworkFirst',
              options: { cacheName: 'map-grids', expiration: { maxEntries: 200, maxAgeSeconds: 3 * 24 * 3600 } },
            },
            {
              urlPattern: ({ url }) => url.hostname.endsWith('tile.openstreetmap.org'),
              handler: 'CacheFirst',
              options: { cacheName: 'osm-tiles', expiration: { maxEntries: 400, maxAgeSeconds: 7 * 24 * 3600 } },
            },
          ],
        },
      }),
    ],
    build: {
      outDir: 'dist',
      sourcemap: true,
      chunkSizeWarningLimit: 900,
    },
    test: {
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts', 'test/**/*.test.ts'],
      environment: 'node',
      coverage: {
        provider: 'v8',
        include: ['src/engine/**/*.ts', 'src/data/**/*.ts'],
        exclude: ['**/*.test.ts'],
        reporter: ['text-summary', 'text', 'json-summary', 'html'],
      },
    },
  };
});
