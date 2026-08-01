import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Phase 0: hello page + dev proxy only. PWA config (vite-plugin-pwa) lands
// in Phase 6 (see PLAN.md §9 / §11 Phase 6).
export default defineConfig({
  plugins: [react()],
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
