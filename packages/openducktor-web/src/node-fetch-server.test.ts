import { test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// The published runner uses Node, so these checks must run there.
test.each([
  [
    "keeps WebSocket backpressure and reports later server errors",
    "node-fetch-server.node-fixture.ts",
  ],
  [
    "compresses HTTP text and delivers live events promptly",
    "node-fetch-server.http-node-fixture.ts",
  ],
])(
  "%s",
  async (_name, fixture) => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "openducktor-web-node-"));
    try {
      const result = await Bun.build({
        entrypoints: [fileURLToPath(new URL(`./${fixture}`, import.meta.url))],
        target: "node",
        outdir: temporaryDirectory,
        naming: "transport-check.mjs",
      });
      if (!result.success) throw new Error(result.logs.map(String).join("\n"));
      const output = result.outputs[0];
      if (!output) throw new Error("The Node transport test bundle is missing.");
      await execFileAsync("node", [output.path], { timeout: 10_000 });
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  },
  15_000,
);
