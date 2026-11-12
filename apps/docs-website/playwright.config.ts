import { defineConfig } from "@playwright/test";
import { ORIGIN, PORT } from "./browser-tests/server";

// The tests check the export in `out/` as Cloudflare serves it. Run `bun run build` first.
export default defineConfig({
  testDir: "./browser-tests",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: ORIGIN, reducedMotion: "reduce", trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop-light",
      use: { viewport: { width: 1440, height: 900 }, colorScheme: "light" },
    },
    { name: "desktop-dark", use: { viewport: { width: 1440, height: 900 }, colorScheme: "dark" } },
    { name: "phone-light", use: { viewport: { width: 360, height: 740 }, colorScheme: "light" } },
    { name: "phone-dark", use: { viewport: { width: 360, height: 740 }, colorScheme: "dark" } },
  ],
  webServer: {
    command: `WRANGLER_SEND_METRICS=false wrangler dev --config wrangler.json --local --ip 127.0.0.1 --port ${PORT}`,
    url: ORIGIN,
    reuseExistingServer: !process.env.CI,
  },
});
