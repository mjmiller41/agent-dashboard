import { defineConfig } from 'vitest/config';

// Phase 6 made `server/dist/` a routine local artifact (`npm run build` for
// `npm start`) rather than something that only briefly existed mid-CI.
// vitest v4's own defaultExclude is just `['**/node_modules/**', '**/.git/**']`
// (it stopped excluding `dist` by default at some point) — without an
// explicit exclude here, a local `npm run build && npm run check` picks up
// every compiled `dist/**/*.test.js` alongside its `src/**/*.test.ts`
// source, silently doubling every test file and its count. Found by
// actually running `npm run check` after a production build (guardrail #7),
// not by inspection.
export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
  },
});
