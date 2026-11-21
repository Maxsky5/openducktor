import { afterAll, beforeAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";
import { sqliteMigrationCopyPlans } from "./sqlite-migration-assets";
import { createLegacyTaskStore, insertLegacyTask } from "./sqlite-task-store-test-support";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
let outputDirectory = "";

beforeAll(async () => {
  outputDirectory = await mkdtemp(path.join(tmpdir(), "odt-import-worker-bundle-"));
  const result = await Bun.build({
    // The worker and the host load migrations from the directory of their shared chunk.
    entrypoints: [
      path.join(sourceDirectory, "host-database-import-worker.ts"),
      path.join(sourceDirectory, "sqlite-migration-assets.ts"),
    ],
    splitting: true,
    outdir: outputDirectory,
    target: "node",
    naming: { entry: "[name].[ext]", chunk: "[name]-[hash].[ext]" },
  });
  if (!result.success) throw new AggregateError(result.logs, "The import worker bundle failed.");
  for (const asset of sqliteMigrationCopyPlans(outputDirectory))
    await cp(asset.sourceDirectory, asset.targetDirectory, { force: true, recursive: true });
});

afterAll(async () => {
  await rm(outputDirectory, { recursive: true, force: true });
});

const runner = `
const { Worker } = require("node:worker_threads");
const worker = new Worker(process.argv[1], {
  workerData: JSON.parse(process.argv[2]),
});
worker.once("message", (reply) => {
  console.log(JSON.stringify(reply));
  worker.terminate();
});
worker.once("error", (cause) => { console.error(cause); process.exit(1); });
`;

test.each(["node", "bun"])(
  "the bundled import worker imports a legacy task under %s",
  async (runtime) => {
    const configRoot = await mkdtemp(path.join(tmpdir(), "odt-import-worker-run-"));
    try {
      const workspaceId = "abcdefghij-work";
      const taskId = "abcdefghij-aaaa";
      const config = createDefaultGlobalConfig();
      config.workspaces[workspaceId] = repoConfigFixture({
        workspaceId,
        repoPath: path.join(configRoot, "repo"),
      });
      const sourcePath = path.join(configRoot, "task-stores", workspaceId, "database.sqlite");
      await createLegacyTaskStore(sourcePath, 9);
      insertLegacyTask({ databasePath: sourcePath, taskId });

      const databasePath = path.join(configRoot, "database.sqlite");
      const child = Bun.spawn(
        [
          runtime,
          "-e",
          runner,
          path.join(outputDirectory, "host-database-import-worker.js"),
          JSON.stringify({ config, configRoot, databasePath }),
        ],
        { stdout: "pipe", stderr: "pipe", env: { ...process.env, NODE_NO_WARNINGS: "1" } },
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);

      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout)).toEqual({ kind: "complete" });
      using database = new Database(databasePath, { readonly: true });
      expect(database.query("SELECT workspace_id, id FROM tasks").all()).toEqual([
        { workspace_id: workspaceId, id: taskId },
      ]);
    } finally {
      await rm(configRoot, { recursive: true, force: true });
    }
  },
);
