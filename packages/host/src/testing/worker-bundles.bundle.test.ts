import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWorkerBundle, workerBundleRuntimes } from "../test-support/worker-bundle-runtimes";

// Electron and the web runner ship these workers as Node bundles. This test builds each worker
// with its fixture and runs the same protocol checks under Node, Bun, and Electron.
const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
// Resolve Electron before the tests start. Only the shard that loads this file needs the download.
const runtimes = workerBundleRuntimes();
let outputDirectory = "";

beforeAll(
  async () => {
    outputDirectory = await mkdtemp(path.join(tmpdir(), "odt-worker-bundles-"));
    const result = await Bun.build({
      entrypoints: [
        path.join(sourceDirectory, "../adapters/attachments/generated-image-worker.ts"),
        path.join(sourceDirectory, "../adapters/claude/claude-transcript-worker.ts"),
        path.join(sourceDirectory, "generated-image-worker-bundle.fixture.ts"),
        path.join(sourceDirectory, "claude-transcript-worker-bundle.fixture.ts"),
      ],
      outdir: outputDirectory,
      target: "node",
      naming: "[name].[ext]",
    });
    if (!result.success) {
      throw new AggregateError(result.logs, "The worker bundle build failed.");
    }
    // The output has no package.json. Mark it as ESM so Node loads the .js bundles as modules.
    await writeFile(path.join(outputDirectory, "package.json"), '{"type":"module"}\n');
  },
  // The build bundles two workers and their dependencies.
  30_000,
);

afterAll(async () => {
  await rm(outputDirectory, { recursive: true, force: true });
});

test.each([
  { name: "generated image", file: "generated-image" },
  { name: "Claude transcript", file: "claude-transcript" },
])(
  "the bundled $name worker handles its protocol under Node, Bun, and Electron",
  async ({ file }) => {
    for (const runtime of runtimes) {
      const stdout = await runWorkerBundle(
        runtime,
        path.join(outputDirectory, `${file}-worker-bundle.fixture.js`),
        path.join(outputDirectory, `${file}-worker.js`),
      );
      expect(stdout).toContain(`Worker bundle passed: ${runtime.name} `);
    }
  },
  // The protocol check starts a child process for each runtime.
  120_000,
);
