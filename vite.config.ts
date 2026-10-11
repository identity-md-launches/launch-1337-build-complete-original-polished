import { defineConfig, type Plugin } from 'vite';

/**
 * The arcade runs the game in a sandboxed iframe without allow-same-origin, so the
 * document has an opaque origin. Module scripts and @font-face loads are always
 * CORS requests, and a static host that omits Access-Control-Allow-Origin would
 * block them. The export therefore ships one classic (IIFE) script with no
 * `crossorigin` attributes and inlines the two font files into the stylesheet.
 */
function classicScript(): Plugin {
  return {
    name: 'tongue-rush-classic-script',
    enforce: 'post',
    transformIndexHtml(html) {
      return html
        .replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, '<script defer src="$1"></script>')
        .replace(/<link rel="stylesheet" crossorigin href="/g, '<link rel="stylesheet" href="')
        .replace(/<link rel="modulepreload"[^>]*>\n?/g, '');
    },
  };
}

// base './' keeps every asset URL relative so the site works from an IPFS
// gateway subpath, an ENS name or a plain folder on disk.
export default defineConfig({
  base: './',
  plugins: [classicScript()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 120_000,
    sourcemap: false,
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
      },
    },
  },
});
