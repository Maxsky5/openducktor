import electronKnipConfig from "./apps/electron/knip.config";
import frontendKnipConfig from "./packages/frontend/knip.config";
import webKnipConfig from "./packages/openducktor-web/knip.config";

export default {
  tags: ["-internal"],
  workspaces: {
    "apps/marketing-website": {
      project: ["src/**/*.{ts,astro}", "config/**/*.ts", "scripts/**/*.ts"],
    },
    "apps/electron": electronKnipConfig,
    "apps/mobile": {
      entry: [
        "src/app/**/*.tsx",
        "src/**/*.test.{ts,tsx}",
        "plugins/*.js",
        "modules/*/index.ts",
        "scripts/*.ts",
        "src/rich-content/isolated-page/page-src/*.ts",
      ],
      project: [
        "src/**/*.{ts,tsx}",
        "modules/*/{index.ts,src/**/*.ts}",
        "scripts/**/*.ts",
        "plugins/*.js",
      ],
      // Knip does not read the configurations that `bun check -p` receives.
      typescript: { config: ["tsconfig.json", "tsconfig.test.json"] },
      // `app.config.ts` embeds the font files by path, and the isolated page styles `@import` KaTeX.
      ignoreDependencies: [
        "@expo-google-fonts/ibm-plex-mono",
        "@expo-google-fonts/space-grotesk",
        "katex",
      ],
    },
    "packages/frontend-core": {
      entry: ["src/**/*.{ts,tsx}", "expo-compat/*.ts"],
      project: ["src/**/*.{ts,tsx}", "expo-compat/*.ts"],
      // Knip does not read the configurations that `bun check -p` receives.
      typescript: { config: ["tsconfig.json", "tsconfig.test.json", "expo-compat/tsconfig.json"] },
    },
    "packages/frontend": frontendKnipConfig,
    "packages/host": {
      drizzle: { config: ["drizzle.task-store.config.ts"] },
      // A Bun macro bundles the page capture code with bippy through `bun build`.
      ignoreDependencies: ["bippy"],
    },
    "packages/openducktor-web": webKnipConfig,
  },
};
