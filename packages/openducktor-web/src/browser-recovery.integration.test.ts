import { test } from "bun:test";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// The rendered owners use global DOM, bridge, and Query state. A child keeps other web tests isolated.
test.each([
  [
    "runtime, Autopilot, and selected terminals share one finite reconnect barrier",
    "./browser-recovery.integration-fixture.tsx",
  ],
  [
    "Retry after failed setup restores mounted owners before work unlocks",
    "./browser-initial-recovery.integration-fixture.ts",
  ],
  [
    "closing one remote window keeps another window's resource reads usable",
    "./browser-resources.integration-fixture.ts",
  ],
])(
  "%s",
  async (_name, fixture) => {
    await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL(fixture, import.meta.url))],
      {
        timeout: 10_000,
        env: { ...process.env, VITE_ODT_APP_VERSION: "test-browser" },
      },
    );
  },
  15_000,
);
