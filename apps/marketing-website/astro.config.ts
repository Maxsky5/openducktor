import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import type { AstroUserConfig } from "astro";
import { readBuildConfig, staticFiles } from "./config/build";
import { prepareAssets } from "./scripts/prepare-assets";
import { productTheme } from "./scripts/product-theme";

const config = readBuildConfig();

/** The layout imports the theme tokens of the desktop app as this CSS module, so Astro bundles them. */
const PRODUCT_THEME = "virtual:openducktor/product-theme.css";
const PRODUCT_THEME_ID = "/__openducktor-product-theme.css";
const productStyles = fileURLToPath(
  new URL("../../packages/frontend/src/styles.css", import.meta.url),
);

const astroConfig: AstroUserConfig = {
  output: "static",
  outDir: "./dist",
  integrations: [
    {
      name: "marketing-static-assets",
      hooks: {
        // Only the dev server and the build read public/. Check and preview keep it as it is.
        "astro:config:setup": async ({ command }) => {
          if (command === "dev" || command === "build") await prepareAssets();
        },
        "astro:build:done": async ({ dir }) => {
          for (const [name, content] of staticFiles(config)) {
            await writeFile(new URL(name, dir), content);
          }
        },
      },
    },
  ],
  vite: {
    // The GSAP license forbids the removal of its notices. The minifier removes them by default.
    build: { rolldownOptions: { output: { comments: { legal: true } } } },
    plugins: [
      {
        name: "openducktor-product-theme",
        resolveId: (id) =>
          id === PRODUCT_THEME || id === PRODUCT_THEME_ID ? PRODUCT_THEME_ID : undefined,
        async load(id) {
          if (id !== PRODUCT_THEME_ID) return undefined;
          this.addWatchFile(productStyles);
          return productTheme(await readFile(productStyles, "utf8"));
        },
      },
    ],
  },
};
if (config.origin) astroConfig.site = config.origin;
export default defineConfig(astroConfig);
