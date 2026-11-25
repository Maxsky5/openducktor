import electronKnipConfig from "./apps/electron/knip.config";
import webKnipConfig from "./packages/openducktor-web/knip.config";

export default {
  workspaces: {
    ".": {
      entry: [".agents/skills/pr-spotlight/scripts/render.ts"],
    },
    "apps/docs-website": {
      entry: ["app/**/*.{ts,tsx}", "scripts/*.ts", "tests/*.test.ts", "browser-tests/*.ts"],
      project: ["**/*.{ts,tsx,mdx,css}"],
      // The export script reads the GSAP notices. The layout and link previews load fonts by path.
      ignoreDependencies: [
        "gsap",
        "@fontsource-variable/space-grotesk",
        "@fontsource/ibm-plex-mono",
        "@expo-google-fonts/space-grotesk",
      ],
    },
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
      // `app.config.ts` embeds the font files by path.
      ignoreDependencies: ["@expo-google-fonts/ibm-plex-mono", "@expo-google-fonts/space-grotesk"],
    },
    "packages/frontend-core": {
      entry: ["src/**/*.test.{ts,tsx}", "expo-compat/consumer.ts"],
      project: ["src/**/*.{ts,tsx}", "expo-compat/*.ts"],
      // Knip does not read the configurations that `bun check -p` receives.
      typescript: { config: ["tsconfig.json", "tsconfig.test.json", "expo-compat/tsconfig.json"] },
    },
    "packages/frontend": {
      // The startup splash plugin reads the font faces as text.
      entry: [
        "src/**/*.test.{ts,tsx}",
        "src/features/browser/browser-tab-content.fixture.tsx",
        "src/fonts/faces.css",
      ],
      project: ["src/**/*.{ts,tsx,css}"],
    },
    "packages/product-scenes": {
      // Knip adds the files of the package.json exports. It does not read `Scene.astro`, because the
      // package has no Astro dependency, so the modules that it imports are entries too.
      entry: [
        "src/astro/{render,mount-page}.ts",
        "src/**/*.test.{ts,tsx}",
        "scripts/*.ts",
        "video/{main,render}.ts",
      ],
      project: ["src/**/*.{ts,tsx}", "scripts/**/*.ts", "video/**/*.ts"],
      // video/page.css loads the font files by path.
      ignoreDependencies: ["@fontsource-variable/space-grotesk", "@fontsource/ibm-plex-mono"],
    },
    "packages/host-client": {
      // Knip does not read the configurations that `bun check -p` receives.
      typescript: { config: ["tsconfig.json", "tsconfig.test.json"] },
    },
    "packages/remote-host": {
      // Knip does not read the configurations that `bun check -p` receives.
      typescript: { config: ["tsconfig.json", "tsconfig.test.json"] },
    },
    "packages/workflows": {
      entry: ["type-tests/**/*.ts"],
    },
    "packages/host": {
      // Bun builds the capture page and starts these fixtures in child processes.
      entry: [
        "src/application/browser/page-capture/browser-page-capture.page.ts",
        "src/testing/*.fixture.ts",
        "src/adapters/claude/claude-agent-sdk-history-*.test-support.ts",
        "src/adapters/claude/test-support/{claude-reply-fork,claude-session-metadata}.ts",
      ],
      drizzle: { config: ["drizzle.host.config.ts"] },
    },
    "packages/openducktor-web": webKnipConfig,
  },
};
