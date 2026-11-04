import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";

import { createLegacyTaskStore } from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { SettingsFileError } from "../../effect/host-errors";
import { createUserEnvironment } from "../../infrastructure/process/user-environment";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { createNodeSharedStorage, loadConfigToImport } from "./node-shared-storage";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const noToolDiscovery = Effect.die("Current settings need no tool discovery.");
const userPath = { environment: { PATH: "/usr/bin" }, error: null };
const toolDiscovery: ToolDiscoveryPort = {
  discoverTool: () => noToolDiscovery,
  resolveTool: () => noToolDiscovery,
  resolveToolPath: () => noToolDiscovery,
  validateToolPath: () => noToolDiscovery,
};

const makePorts = async () => {
  const configRoot = await mkdtemp(path.join(tmpdir(), "odt-shared-storage-"));
  directories.push(configRoot);
  return {
    configDir: { root: configRoot, scope: "test" as const },
    toolDiscovery,
    userEnvironment: createUserEnvironment(userPath, Effect.succeed(userPath)),
  };
};

const startStorage = async (ports: Awaited<ReturnType<typeof makePorts>>) => {
  const phases: string[] = [];
  const storage = await Effect.runPromise(
    createNodeSharedStorage(ports, builtinTaskWorkflows, (phase) =>
      Effect.sync(() => void phases.push(phase)),
    ),
  );
  await Effect.runPromise(storage.taskDatabase.dispose());
  return phases;
};

test("imports settings without the worker when no legacy task store exists", async () => {
  const ports = await makePorts();
  const configPath = path.join(ports.configDir.root, "config.json");
  await writeFile(configPath, JSON.stringify(createDefaultGlobalConfig()));

  expect(await startStorage(ports)).toEqual([]);
  expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({ version: 5 });
});

test("reports the worker import when a legacy task store exists", async () => {
  const ports = await makePorts();
  const config = createDefaultGlobalConfig();
  config.workspaces.alpha = repoConfigFixture({
    workspaceId: "alpha",
    workspaceName: "Alpha",
    repoPath: "/repos/alpha",
  });
  await writeFile(path.join(ports.configDir.root, "config.json"), JSON.stringify(config));
  await createLegacyTaskStore(
    path.join(ports.configDir.root, "task-stores", "alpha", "database.sqlite"),
    11,
  );

  expect(await startStorage(ports)).toEqual(["started", "finished"]);
});

describe("loadConfigToImport", () => {
  const preferencesOnly = new SettingsFileError({
    reason: "databaseMissing",
    path: "/config.json",
    message: "preferences only",
  });

  test("returns null when another host finished the import", async () => {
    expect(
      await Effect.runPromise(
        loadConfigToImport(Effect.fail(preferencesOnly), Effect.succeed(false)),
      ),
    ).toBeNull();
  });

  test("keeps the error when the import is still pending", async () => {
    expect(
      await Effect.runPromise(
        Effect.flip(loadConfigToImport(Effect.fail(preferencesOnly), Effect.succeed(true))),
      ),
    ).toBe(preferencesOnly);
  });
});
