import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createDefaultGlobalConfig } from "../packages/host/src/config/global-config";
import { repoConfigFixture } from "../packages/host/src/test-support/repo-config-fixture";
import {
  createLegacyTaskStore,
  insertLegacyTask,
} from "../packages/host/src/adapters/sqlite/sqlite-task-store-test-support";

const run = promisify(execFile);
const runner = `
const { Worker } = require("node:worker_threads");
const worker = new Worker(new URL(process.argv[1]), {
  workerData: JSON.parse(process.argv[2]),
});
worker.once("message", (reply) => {
  console.log(JSON.stringify(reply));
  worker.terminate();
});
worker.once("error", (cause) => { console.error(cause); process.exit(1); });
`;

describe.each(["apps/electron", "packages/openducktor-web"])("%s", (shell) => {
  const worker = new URL(`../${shell}/dist/host-database-import-worker.js`, import.meta.url);

  test.each(["node", "bun"])("the built worker imports a legacy task under %s", async (runtime) => {
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
      const { stdout } = await run(
        runtime,
        ["-e", runner, worker.href, JSON.stringify({ config, configRoot, databasePath })],
        { cwd: configRoot },
      );

      expect(JSON.parse(stdout)).toEqual({ kind: "complete" });
      using database = new Database(databasePath, { readonly: true });
      expect(database.query("SELECT workspace_id, id FROM tasks").all()).toEqual([
        { workspace_id: workspaceId, id: taskId },
      ]);
    } finally {
      await rm(configRoot, { recursive: true, force: true });
    }
  });
});
