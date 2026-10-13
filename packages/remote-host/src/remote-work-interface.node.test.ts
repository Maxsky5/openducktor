import { test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Both shells use Node Request semantics, which differ from Bun's body transfer behavior.
test("remote POST routes retain their bodies on Node", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openducktor-remote-node-"));
  try {
    const result = await Bun.build({
      entrypoints: [
        fileURLToPath(new URL("./remote-work-interface.node-fixture.ts", import.meta.url)),
      ],
      target: "node",
      outdir: directory,
      naming: "remote-check.mjs",
    });
    if (!result.success) throw new Error(result.logs.map(String).join("\n"));
    const output = result.outputs[0];
    if (!output) throw new Error("The Node remote test bundle is missing.");
    await promisify(execFile)("node", [output.path], { timeout: 10_000 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
