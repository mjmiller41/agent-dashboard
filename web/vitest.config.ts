import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Phase 2: unit tests for the shell (router/store/hook logic). Uses
// happy-dom (not jsdom) as the DOM environment — see DECISIONS.md "Phase 2
// — Shell" for why a DOM environment package was added even though PLAN.md
// §2 doesn't list one.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
  },
});
