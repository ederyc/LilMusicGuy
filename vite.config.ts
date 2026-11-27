import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the desktop app can load the build from disk (file://).
  base: './',
  build: {
    // It's a desktop app loading from disk; one ~540 kB bundle (mostly three.js) is fine.
    chunkSizeWarningLimit: 1000,
  },
});
