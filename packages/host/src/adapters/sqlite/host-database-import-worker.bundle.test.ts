import { afterAll, beforeAll, expect, test } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Electron and the web runner ship the import worker as one unsplit bundle next to the migration
// folders. In a split build, the migration code moves into a chunk folder and resolves its
// migrations from there. This test builds the worker the same way and runs the bundle.
const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
let outputDirectory = "";

beforeAll(async () => {
  outputDirectory = await mkdtemp(path.join(tmpdir(), "odt-import-worker-bundle-"));
  const result = await Bun.build({
    entrypoints: [path.join(sourceDirectory, "host-database-import-worker.ts")],
    outdir: outputDirectory,
    target: "node",
    naming: "[name].[ext]",
  });
  if (!result.success) throw new AggregateError(result.logs, "The import worker bundle failed.");
  for (const folder of ["drizzle", "drizzle-host"])
    await cp(path.join(sourceDirectory, folder), path.join(outputDirectory, folder), {
      recursive: true,
    });
});

afterAll(async () => {
  await rm(outputDirectory, { recursive: true, force: true });
});

// An empty config fails after the schema step, so an import failure shows that the bundle found
// and applied its migrations.
const runner = `
const { Worker } = require("node:worker_threads");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const configRoot = mkdtempSync(join(require("node:os").tmpdir(), "odt-import-worker-run-"));
const worker = new Worker(process.argv[1], {
  workerData: { config: {}, configRoot, databasePath: join(configRoot, "database.sqlite") },
});
worker.once("message", (reply) => {
  console.log(JSON.stringify(reply));
  rmSync(configRoot, { recursive: true, force: true });
  worker.terminate();
});
worker.once("error", (cause) => { console.error(cause); process.exit(1); });
`;

test.each(["node", "bun"])(
  "the bundled import worker applies its migrations under %s",
  async (runtime) => {
    const child = Bun.spawn(
      [runtime, "-e", runner, path.join(outputDirectory, "host-database-import-worker.js")],
      { stdout: "pipe", stderr: "pipe", env: { ...process.env, NODE_NO_WARNINGS: "1" } },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ kind: "error", operation: "hostDatabase.import" });
  },
);
