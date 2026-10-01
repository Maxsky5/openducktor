import { test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// The packaged server runs under Node. Bundle its HTTP contract checks for that runtime.
test("serves packaged assets with cache validation under Node", async () => {
  const directory = await mkdtemp(join(tmpdir(), "odt-static-node-"));
  try {
    const result = await Bun.build({
      entrypoints: [
        fileURLToPath(new URL("./static-frontend-server.node-fixture.ts", import.meta.url)),
      ],
      target: "node",
      outdir: directory,
      naming: "static-check.mjs",
    });
    if (!result.success) throw new Error(result.logs.map(String).join("\n"));
    const output = result.outputs[0];
    if (!output) throw new Error("The Node static server test bundle is missing.");
    await execFileAsync("node", ["--test", output.path], { timeout: 10_000 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
