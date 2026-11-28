/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';

/**
 * The page's Content-Security-Policy allows talking to localhost only so the dev server's
 * hot reload works. The built app (what the desktop app loads) gets no network access at
 * all: anything other than its own files is refused by the page itself.
 */
function productionCsp(): Plugin {
  return {
    name: 'lmg-production-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const devConnect = "connect-src 'self' ws://localhost:* http://localhost:*";
      if (!html.includes(devConnect)) throw new Error('CSP connect-src not found in index.html; update vite.config.ts');
      return html.replace(devConnect, "connect-src 'self'");
    },
  };
}

export default defineConfig({
  // Relative asset paths, so the desktop app can load the build from disk (file://).
  base: './',
  plugins: [productionCsp()],
  // Dev/preview servers stay on Vite's default host (localhost: this machine only), and
  // don't answer cross-origin requests from other sites.
  server: { cors: false },
  preview: { cors: false },
  build: {
    // It's a desktop app loading from disk; one ~540 kB bundle (mostly three.js) is fine.
    chunkSizeWarningLimit: 1000,
    // Scripts (the audio worklet) must ship as real files: the CSP refuses data: scripts.
    assetsInlineLimit: (file) => (file.endsWith('.js') ? false : undefined),
  },
  test: {
    // The audio tests analyse several seconds of real sound; give them room.
    testTimeout: 30000,
  },
});
