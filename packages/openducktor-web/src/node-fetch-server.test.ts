import { test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// The published runner uses Node's ws implementation, so this check runs under Node.
test("keeps WebSocket backpressure until all queued frames finish", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "openducktor-web-socket-"));
  try {
    const result = await Bun.build({
      entrypoints: [fileURLToPath(new URL("./node-fetch-server.node-fixture.ts", import.meta.url))],
      target: "node",
      outdir: temporaryDirectory,
      naming: "socket-check.mjs",
    });
    if (!result.success) throw new Error(result.logs.map(String).join("\n"));
    const output = result.outputs[0];
    if (!output) throw new Error("The Node WebSocket test bundle is missing.");
    await execFileAsync("node", [output.path], { timeout: 10_000 });
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}, 15_000);
