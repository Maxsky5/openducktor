import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWorkerBundle, workerBundleRuntimes } from "../test-support/worker-bundle-runtimes";

// Electron and the web runner ship these workers as Node bundles. This test builds each worker
// with its fixture and runs the same protocol checks under Node, Bun, and Electron.
const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = path.join(sourceDirectory, "../testing");
let outputDirectory = "";

beforeAll(
  async () => {
    outputDirectory = await mkdtemp(path.join(tmpdir(), "odt-worker-bundles-"));
    const result = await Bun.build({
      entrypoints: [
        path.join(sourceDirectory, "attachments/generated-image-worker.ts"),
        path.join(sourceDirectory, "claude/claude-transcript-worker.ts"),
        path.join(fixtureDirectory, "generated-image-worker-bundle.fixture.ts"),
        path.join(fixtureDirectory, "claude-transcript-worker-bundle.fixture.ts"),
      ],
      outdir: outputDirectory,
      target: "node",
      naming: "[name].[ext]",
    });
    if (!result.success) {
      throw new AggregateError(result.logs, "The worker bundle build failed.");
    }
  },
  // The build bundles two workers and their dependencies.
  30_000,
);

afterAll(async () => {
  await rm(outputDirectory, { recursive: true, force: true });
});

test(
  "the bundled generated image worker handles its protocol under Node, Bun, and Electron",
  async () => {
    for (const runtime of workerBundleRuntimes()) {
      const stdout = await runWorkerBundle(
        runtime,
        path.join(outputDirectory, "generated-image-worker-bundle.fixture.js"),
        path.join(outputDirectory, "generated-image-worker.js"),
      );
      expect(stdout).toContain(`Worker bundle passed: ${runtime.name} `);
    }
  },
  // The first run may download the Electron runtime before it spawns three child processes.
  120_000,
);

test(
  "the bundled Claude transcript worker handles its protocol under Node, Bun, and Electron",
  async () => {
    for (const runtime of workerBundleRuntimes()) {
      const stdout = await runWorkerBundle(
        runtime,
        path.join(outputDirectory, "claude-transcript-worker-bundle.fixture.js"),
        path.join(outputDirectory, "claude-transcript-worker.js"),
      );
      expect(stdout).toContain(`Worker bundle passed: ${runtime.name} `);
    }
  },
  // The first run may download the Electron runtime before it spawns three child processes.
  120_000,
);
