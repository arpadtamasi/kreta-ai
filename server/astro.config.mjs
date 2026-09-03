import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  outDir: "./public",
  publicDir: "./web/public",
  srcDir: "./web/src",
  site: "https://uzenofuzet.tilosazai.org",
  build: {
    assets: "_astro",
    // Keep the production CSP strict: page-level styles must be emitted as
    // files instead of Astro's small inline <style> blocks.
    inlineStylesheets: "never",
  },
  // The backend's Express tree also depends on the older CommonJS `cookie`
  // package. Keep Astro's ESM copy explicit during prerendering.
  vite: {
    resolve: {
      alias: {
        cookie: fileURLToPath(
          new URL("./node_modules/astro/node_modules/cookie/dist/index.js", import.meta.url),
        ),
      },
    },
  },
});
