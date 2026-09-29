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
    "packages/frontend": frontendKnipConfig,
    "packages/host": {
      drizzle: { config: ["drizzle.task-store.config.ts"] },
    },
    "packages/openducktor-web": webKnipConfig,
  },
};
