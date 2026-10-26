import { test } from "bun:test";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// The fixture starts a real host. A child process keeps its listeners and globals out of other tests.
test(
  "the mobile host session connects to a real host, runs work, reconnects, and removes the host",
  async () => {
    await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL("./mobile-host-session.integration-fixture.ts", import.meta.url))],
      // The test preload points OPENDUCKTOR_CONFIG_DIR at a temporary folder for this worker.
      { timeout: 20_000, env: { ...process.env } },
    );
  },
  // The real host start, Git setup, and reconnect take a few seconds.
  25_000,
);
