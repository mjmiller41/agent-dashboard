import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Matches both the shared loopback callback (`/api/providers/oauth/callback`)
// and every per-provider start/paste route (`/api/providers/:id/oauth/...`) —
// PLAN.md §9's "NetworkOnly for ... OAuth routes (/api/providers/*/oauth/*)".
const OAUTH_ROUTE_PATTERN = /^\/api\/providers\/(?:[^/]+\/)?oauth\//;

// Phase 6 (PLAN.md §9/§11): vite-plugin-pwa config. registerType
// 'autoUpdate' + injectRegister 'auto' means the plugin injects its own
// registration script into index.html — no hand-written registerSW call
// needed for the "a service worker registers" acceptance bar.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['pwa/logo.svg'],
      manifest: {
        name: 'Agent Dashboard',
        short_name: 'Agent Dashboard',
        description:
          'Self-hosted, installable command centre for AI agents — a local-first, file-backed multi-agent dashboard.',
        // Colors pulled from theme.css's default 'dark' preset (PLAN.md §9).
        theme_color: '#7c5cff',
        background_color: '#14151a',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'pwa/pwa-maskable-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: 'pwa/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Precache the app shell + every lazy panel chunk — Vite's own build
        // output glob, vite-plugin-pwa's default `generateSW` behavior (not
        // hand-rolled manifest globbing, per PLAN.md §9).
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        runtimeCaching: [
          // NetworkOnly: OAuth routes, streaming chat, and the SSE stream —
          // none of these should ever be served stale/cached.
          { urlPattern: OAUTH_ROUTE_PATTERN, method: 'GET', handler: 'NetworkOnly' },
          { urlPattern: OAUTH_ROUTE_PATTERN, method: 'POST', handler: 'NetworkOnly' },
          { urlPattern: /\/api\/chat(?:$|\?)/, method: 'POST', handler: 'NetworkOnly' },
          { urlPattern: /\/api\/events(?:$|\?)/, method: 'GET', handler: 'NetworkOnly' },
          // NetworkFirst: workspace files + the provider registry, so a
          // relaunch with the server down still shows the last snapshot
          // (PLAN.md §9).
          {
            urlPattern: /\/api\/ws\//,
            method: 'GET',
            handler: 'NetworkFirst',
            options: { cacheName: 'ws-api', networkTimeoutSeconds: 3 },
          },
          {
            urlPattern: /\/api\/providers(?:$|\?)/,
            method: 'GET',
            handler: 'NetworkFirst',
            options: { cacheName: 'providers-api', networkTimeoutSeconds: 3 },
          },
        ],
      },
    }),
  ],
  server: {
    // Fixed, non-fallback port: e2e/playwright.config.ts's webServer waits
    // on a specific URL (localhost:5173) and needs to know Vite actually
    // bound it rather than silently shifting to 5174+ if busy.
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4680',
        changeOrigin: true,
      },
    },
  },
});
