import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type AgentSessionRecord } from "@openducktor/contracts";
import { Effect } from "effect";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { loadLegacySettingsConfig } from "../settings/settings-config-file";
import { runHostDatabaseImportWorker } from "./host-database-import-worker-client";
import { HostDatabaseImportSourceError } from "./host-database-import-worker-protocol";
import {
  importHostDatabase,
  importSnapshotRoot,
  isHostDatabaseImportPending,
} from "./sqlite-host-database-import";
import { createSqliteSharedSettingsDatabase } from "./sqlite-shared-settings-database";
import { createSqliteTaskRepository } from "./sqlite-task-repository";
import { createSqliteHostDatabaseManager } from "./sqlite-task-repository-context";
import { tasks } from "./sqlite-host-database-schema";
import { createLegacyTaskStore } from "./sqlite-task-store-test-support";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";

const run = Effect.runPromise;
const managers: ReturnType<typeof createSqliteHostDatabaseManager>[] = [];
const directories: string[] = [];
const sources: Database[] = [];
afterEach(async () => {
  for (const database of sources.splice(0)) database.close();
  for (const manager of managers.splice(0)) await run(manager.dispose());
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const makeRoot = async () => {
  const configRoot = await mkdtemp(path.join(tmpdir(), "odt-host-import-"));
  directories.push(configRoot);
  const config = createDefaultGlobalConfig();
  config.hostId = "11111111-1111-4111-8111-111111111111";
  config.theme = "dark";
  config.agentRuntimes.claude.defaults = {
    permissions: { allow: [] },
    sandbox: { enabled: false, filesystem: {}, network: { strictAllowlist: false } },
  };
  config.agentRuntimes.claude.roleOverrides = {
    build: { permissions: { allow: ["Bash(git *)", "Read", "Bash(git *)"] } },
    qa: {},
  };
  config.agentRuntimes.codex.roleOverrides = { build: { commandNetworkAccess: false } };
  config.agentRuntimes.opencode.defaults.rules = [
    { permission: "bash", pattern: "git *", action: "ask" },
    { permission: "read", pattern: "*", action: "allow" },
  ];
  for (const suffix of ["one", "two"]) {
    const workspaceId = `abcdefghij-${suffix}`;
    config.workspaces[workspaceId] = repoConfigFixture({
      workspaceId,
      workspaceName: suffix,
      repoPath: `/repos/${suffix}`,
      closed: suffix === "two",
      agentStudioState: { openTaskIds: ["abcdefghij-aaaa"] },
    });
  }
  config.activeWorkspace = "abcdefghij-one";
  const configPath = path.join(configRoot, "config.json");
  const originalConfig = `${JSON.stringify(config, null, 2)}\n`;
  await writeFile(configPath, originalConfig);
  return { configRoot, config, configPath, originalConfig };
};
const makeManager = (configRoot: string) => {
  const manager = createSqliteHostDatabaseManager({
    configDir: configRoot,
    taskWorkflows: builtinTaskWorkflows,
  });
  managers.push(manager);
  return manager;
};
const initialize = (configRoot: string, manager: ReturnType<typeof makeManager>) =>
  // Startup reads the legacy config only while the import is pending, as `createNodeSharedStorage` does.
  manager
    .withHostDatabase("test.pending", isHostDatabaseImportPending)
    .pipe(
      Effect.flatMap((pending) =>
        pending
          ? loadLegacySettingsConfig(path.join(configRoot, "config.json"), () =>
              Effect.die("Import fixture must contain current settings"),
            ).pipe(
              Effect.flatMap((config) =>
                manager.withHostDatabase("test.import", (session) =>
                  importHostDatabase({ session, configRoot, config }),
                ),
              ),
            )
          : Effect.void,
      ),
    );

const createSource = async (configRoot: string, workspaceId: string) => {
  const databasePath = path.join(configRoot, "task-stores", workspaceId, "database.sqlite");
  await createLegacyTaskStore(databasePath, 11);
  const source = new Database(databasePath);
  sources.push(source);
  source.exec("PRAGMA journal_mode = WAL");
  const savedSession: AgentSessionRecord = {
    externalSessionId: "shared-session-id",
    role: "spec",
    runtimeKind: "codex",
    workingDirectory: `/repos/${workspaceId}`,
    startedAt: "2026-10-27T12:00:00.000Z",
    selectedModel: null,
  };
  source.run(
    `INSERT INTO tasks (id,title,description,status,issue_type,priority,labels_json,agent_sessions_json,created_at_ms,updated_at_ms)
    VALUES (?,?,'saved description','open','task',2,'["one","two"]',?,1000,2000)`,
    ["abcdefghij-aaaa", workspaceId, JSON.stringify([savedSession])],
  );
  for (const revision of [1, 2])
    source.run(
      `INSERT INTO tasks_artifacts
    (artifact_id,task_id,classification,code,revision,name,markdown,format,source_tool,updated_by,updated_at_ms)
    VALUES (?,?,'workflow','spec',?,'Specification',?,'plain_text','odt_set_task_artifact','spec',2000)`,
      [
        "workflow:abcdefghij-aaaa:spec",
        "abcdefghij-aaaa",
        revision,
        `source ${workspaceId} revision ${revision}`,
      ],
    );
  return { source, databasePath, savedSession };
};

describe("atomic host database import", () => {
  test("preserves colliding workspace task and artifact identities, WAL data, and original config", async () => {
    const root = await makeRoot();
    const { savedSession, source } = await createSource(root.configRoot, "abcdefghij-one");
    const files = Array.from({ length: 6 }, (_, index) => Buffer.from([index, 0, 255, 195, 169]));
    for (const [index, content] of files.entries())
      source.run(
        `insert into tasks_artifacts (artifact_id,task_id,classification,code,revision,name,content,file_name,media_type,byte_size,updated_at_ms) values (?,?,'free',?,1,?,?,'data.bin','application/octet-stream',?,2000)`,
        [
          `file-${index}`,
          "abcdefghij-aaaa",
          `file-${index}`,
          `File ${index}`,
          content,
          content.length,
        ],
      );
    await createSource(root.configRoot, "abcdefghij-two");
    const manager = makeManager(root.configRoot);
    await run(initialize(root.configRoot, manager));
    expect(await readFile(root.configPath, "utf8")).toBe(root.originalConfig);
    expect(
      (await run(createSqliteSharedSettingsDatabase(manager).readConfig()))?.agentRuntimes,
    ).toEqual(root.config.agentRuntimes);
    const repository = createSqliteTaskRepository({
      contextProvider: manager.withDatabase,
    });
    const task = await run(
      repository.getTask({
        workspaceId: "abcdefghij-one",
        repoPath: "/repos/one",
        taskId: "abcdefghij-aaaa",
      }),
    );
    expect(task.title).toBe("abcdefghij-one");
    for (const [index, content] of files.entries()) {
      const stored = await run(
        repository.readArtifact({
          workspaceId: "abcdefghij-one",
          repoPath: "/repos/one",
          taskId: task.id,
          artifactId: `file-${index}`,
        }),
      );
      expect(stored?.content).toEqual(content);
    }
    expect(
      await run(
        repository.listAgentSessionsForTasks({
          workspaceId: "abcdefghij-one",
          repoPath: "/repos/one",
          taskIds: [task.id],
        }),
      ),
    ).toEqual([{ taskId: task.id, agentSessions: [savedSession] }]);
    const metadata = await run(
      repository.getTaskMetadata({
        workspaceId: "abcdefghij-one",
        repoPath: "/repos/one",
        taskId: task.id,
      }),
    );
    expect(metadata.artifacts.spec?.markdown).toBe("source abcdefghij-one revision 2");
    await expect(
      run(
        repository.getTask({
          workspaceId: "abcdefghij-two",
          repoPath: "/repos/two",
          taskId: task.id,
        }),
      ),
    ).rejects.toThrow("closed");
    const stored = await run(
      manager.withHostDatabase("test.rows", (session) =>
        session.execute((db) => db.select().from(tasks), "test.rows"),
      ),
    );
    expect(stored.map(({ title }) => title).sort()).toEqual(["abcdefghij-one", "abcdefghij-two"]);
    await writeFile(root.configPath, "invalid JSON after import");
    expect(
      (
        await run(
          repository.getTask({
            workspaceId: "abcdefghij-one",
            repoPath: "/repos/one",
            taskId: task.id,
          }),
        )
      ).title,
    ).toBe("abcdefghij-one");
    await run(initialize(root.configRoot, manager));
  });

  test("rolls back all sources on a corrupt store, then imports once after correction", async () => {
    const root = await makeRoot();
    await createSource(root.configRoot, "abcdefghij-one");
    const bad = path.join(root.configRoot, "task-stores", "abcdefghij-two", "database.sqlite");
    await createLegacyTaskStore(bad, 11);
    await writeFile(bad, "invalid sqlite bytes");
    const manager = makeManager(root.configRoot);
    await expect(run(initialize(root.configRoot, manager))).rejects.toThrow("abcdefghij-two");
    expect(await readFile(root.configPath, "utf8")).toBe(root.originalConfig);
    expect(await readFile(bad, "utf8")).toBe("invalid sqlite bytes");
    const rows = await run(
      manager.withHostDatabase("test.rows", (session) =>
        session.execute((db) => db.select().from(tasks), "test.rows"),
      ),
    );
    expect(rows).toEqual([]);
    await rm(bad);
    await createSource(root.configRoot, "abcdefghij-two");
    await run(initialize(root.configRoot, manager));
    await run(initialize(root.configRoot, manager));
    const finalRows = await run(
      manager.withHostDatabase("test.rows", (session) =>
        session.execute((db) => db.select().from(tasks), "test.rows"),
      ),
    );
    expect(finalRows).toHaveLength(2);
  });

  test("rolls back earlier pages when a later legacy task is invalid", async () => {
    const root = await makeRoot();
    const { source } = await createSource(root.configRoot, "abcdefghij-one");
    source.exec(`with recursive n(i) as (select 1 union all select i+1 from n where i < 101)
      insert into tasks (id,title,status,issue_type,priority,labels_json,agent_sessions_json,created_at_ms,updated_at_ms)
      select 'page-'||i, 'Task', 'open', 'task', 2, '[]', case when i=101 then 'invalid' else '[]' end, 0, 0 from n`);
    const manager = makeManager(root.configRoot);
    await expect(run(initialize(root.configRoot, manager))).rejects.toThrow("agentSessions");
    const rows = await run(
      manager.withHostDatabase("test.rows", (session) =>
        session.execute((db) => db.select().from(tasks), "test.rows"),
      ),
    );
    expect(rows).toEqual([]);
    expect(source.query("select agent_sessions_json from tasks where id='page-101'").get()).toEqual(
      { agent_sessions_json: "invalid" },
    );
    expect(await readFile(root.configPath, "utf8")).toBe(root.originalConfig);
    source.run("update tasks set agent_sessions_json='[]' where id='page-101'");
    await run(initialize(root.configRoot, manager));
    const stored = await run(
      manager.withHostDatabase("test.rows", (session) =>
        session.execute((db) => db.select().from(tasks), "test.rows"),
      ),
    );
    expect(stored).toHaveLength(102);
  });

  test("serializes concurrent upgraded starts and preserves independent shared edits", async () => {
    const root = await makeRoot();
    await createSource(root.configRoot, "abcdefghij-one");
    const first = makeManager(root.configRoot);
    const second = makeManager(root.configRoot);
    await Promise.all([
      run(initialize(root.configRoot, first)),
      run(initialize(root.configRoot, second)),
    ]);
    const left = createSqliteSharedSettingsDatabase(first);
    const right = createSqliteSharedSettingsDatabase(second);
    await Promise.all([
      run(
        left.updateConfig((current) => ({
          ...current,
          git: { ...current.git, defaultMergeMethod: "squash" },
        })),
      ),
      run(
        right.updateConfig((current) => ({
          ...current,
          git: { ...current.git, removeWorktreeOnClose: false },
        })),
      ),
    ]);
    expect((await run(left.readConfig()))?.git).toEqual({
      defaultMergeMethod: "squash",
      removeWorktreeOnClose: false,
    });
    expect((await run(right.readConfig()))?.hostId).toBe(root.config.hostId);
    expect(await readFile(root.configPath, "utf8")).toBe(root.originalConfig);
  });
});

describe("host database import worker", () => {
  const loadConfig = (configPath: string) =>
    loadLegacySettingsConfig(configPath, () =>
      Effect.die("Import fixture must contain current settings"),
    );

  test("imports on a worker thread and removes its snapshot folder", async () => {
    const root = await makeRoot();
    await createSource(root.configRoot, "abcdefghij-one");
    const config = await run(loadConfig(root.configPath));
    await run(
      runHostDatabaseImportWorker({
        config,
        configRoot: root.configRoot,
        databasePath: path.join(root.configRoot, "database.sqlite"),
      }),
    );
    const manager = makeManager(root.configRoot);
    const rows = await run(
      manager.withHostDatabase("test.rows", (session) =>
        session.execute((db) => db.select({ title: tasks.title }).from(tasks), "test.rows"),
      ),
    );
    expect(rows).toEqual([{ title: "abcdefghij-one" }]);
    expect(await run(manager.withHostDatabase("test.pending", isHostDatabaseImportPending))).toBe(
      false,
    );
    await expect(stat(importSnapshotRoot(root.configRoot))).rejects.toThrow();
  });

  test("returns the source path of a failed import", async () => {
    const root = await makeRoot();
    const bad = path.join(root.configRoot, "task-stores", "abcdefghij-two", "database.sqlite");
    await createLegacyTaskStore(bad, 11);
    await writeFile(bad, "invalid sqlite bytes");
    const config = await run(loadConfig(root.configPath));
    const failure = await run(
      runHostDatabaseImportWorker({
        config,
        configRoot: root.configRoot,
        databasePath: path.join(root.configRoot, "database.sqlite"),
      }).pipe(Effect.flip),
    );
    expect(failure).toBeInstanceOf(HostDatabaseImportSourceError);
    expect(failure.message).toContain(bad);
    expect(failure).toMatchObject({ sourcePath: bad });
  });
});
