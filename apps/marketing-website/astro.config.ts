import { writeFile } from "node:fs/promises";
import { defineConfig } from "astro/config";
import type { AstroUserConfig } from "astro";
import { readBuildConfig, staticFiles } from "./config/build";
import { prepareAssets } from "./scripts/prepare-assets";

const config = readBuildConfig();

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
  },
};
if (config.origin) astroConfig.site = config.origin;
export default defineConfig(astroConfig);
