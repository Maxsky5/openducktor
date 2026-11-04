import type { SettingsConfigView } from "../../ports/settings-config-port";
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Effect } from "effect";
import { withConfigCommit } from "../config/config-commit";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { importHostDatabase } from "../sqlite/sqlite-host-database-import";
import { createSqliteSharedSettingsDatabase } from "../sqlite/sqlite-shared-settings-database";
import { createSqliteHostDatabaseManager } from "../sqlite/sqlite-task-repository-context";
import { createSettingsConfigAdapter } from "./settings-config-adapter";
import {
  loadLegacySettingsConfig,
  migrateSettingsConfig,
  readSettingsConfigFile,
} from "./settings-config-file";
import { createWorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";
import { createSharedSettingsFixture } from "../../test-support/shared-settings-fixture";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";

test("preference-only edits use scoped reads and do not notify shared-config observers", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "odt-theme-preferences-"));
  const configPath = path.join(root, "config.json");
  const config = createDefaultGlobalConfig();
  config.workspaces.first = repoConfigFixture({
    workspaceId: "first",
    workspaceName: "First",
    repoPath: "/first",
  });
  config.workspaces.second = repoConfigFixture({
    workspaceId: "second",
    workspaceName: "Second",
    repoPath: "/second",
    closed: true,
  });
  const fixture = await createSharedSettingsFixture({ configPath, config });
  try {
    const reads: string[] = [];
    const adapter = createSettingsConfigAdapter({
      configPath,
      sharedSettings: {
        ...fixture.database,
        updateConfig: () => Effect.die("A theme save must not open a shared settings write"),
        readConfig: () => Effect.die("A preference-only edit must not read all shared settings"),
        readRepoConfig: (workspaceId) => {
          reads.push(workspaceId);
          return fixture.database.readRepoConfig(workspaceId);
        },
      },
    });
    const committed: SettingsConfigView[] = [];
    const observed = withConfigCommit(adapter, (config) =>
      Effect.sync(() => {
        committed.push(config);
      }),
    );
    const service = createWorkspaceSettingsService(observed, builtinTaskWorkflows);
    await Effect.runPromise(service.setTheme("dark"));
    expect(reads).toEqual([]);
    await Promise.all([
      Effect.runPromise(
        service.applyAgentStudioStateAction("first", { type: "ensure_tab", taskId: "a" }),
      ),
      Effect.runPromise(
        service.applyAgentStudioStateAction("first", { type: "ensure_tab", taskId: "b" }),
      ),
    ]);
    const closed = await Effect.runPromise(
      service.replaceAgentStudioState("second", { openTaskIds: ["closed"] }),
    );
    expect(closed.closed).toBe(true);
    expect(reads).toEqual(["first", "first", "second"]);
    const saved = JSON.parse(await readFile(configPath, "utf8"));
    expect(saved.workspaceUi.first.agentStudioState.openTaskIds).toEqual(["a", "b"]);
    expect(saved.workspaceUi.second.agentStudioState.openTaskIds).toEqual(["closed"]);
    await expect(
      Effect.runPromise(service.replaceAgentStudioState("missing", { openTaskIds: [] })),
    ).rejects.toThrow("Workspace not found");
    expect(await readFile(configPath, "utf8")).toBe(JSON.stringify(saved, null, 2) + "\n");
    expect(JSON.parse(await readFile(configPath, "utf8")).theme).toBe("dark");
    expect(committed).toEqual([]);
  } finally {
    await fixture.cleanup();
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps shared edits and classified preferences after settings migration", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "odt-preferences-"));
  const configPath = path.join(root, "config.json");
  const legacy = createDefaultGlobalConfig();
  legacy.theme = "dark";
  legacy.workspaces.first = repoConfigFixture({
    workspaceId: "first",
    workspaceName: "First",
    agentStudioState: { openTaskIds: ["task-1"] },
  });
  const original = JSON.stringify(legacy);
  await writeFile(configPath, original);
  const manager = createSqliteHostDatabaseManager({
    configDir: root,
    taskWorkflows: builtinTaskWorkflows,
  });
  try {
    await Effect.runPromise(
      manager.withHostDatabase("test.bootstrap", (session) =>
        importHostDatabase({
          session,
          configRoot: root,
          config: legacy,
        }),
      ),
    );
    await Effect.runPromise(migrateSettingsConfig(configPath));
    expect(await readFile(`${configPath}.backup`, "utf8")).toBe(original);
    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
      version: 5,
      theme: "dark",
    });
    const database = createSqliteSharedSettingsDatabase(manager);
    const adapter = createSettingsConfigAdapter({ configPath, sharedSettings: database });
    const peer = createSettingsConfigAdapter({ configPath, sharedSettings: database });
    await Effect.runPromise(adapter.readConfig());
    await Effect.runPromise(
      adapter.updateConfig((current) => ({
        ...current,
        theme: "light",
        git: { ...current.git, defaultMergeMethod: "squash" },
      })),
    );
    await Effect.runPromise(
      peer.updateConfig((current) => ({
        ...current,
        autopilot: { ...current.autopilot, alwaysStartQaReviewsFresh: true },
      })),
    );
    const merged = await Effect.runPromise(adapter.readConfig());
    expect(merged!.git.defaultMergeMethod).toBe("squash");
    expect(merged!.autopilot.alwaysStartQaReviewsFresh).toBe(true);
    const stored = JSON.parse(await readFile(configPath, "utf8"));
    expect(stored.version).toBe(5);
    expect(stored.theme).toBe("light");
    expect(stored.workspaceUi.first.agentStudioState.openTaskIds).toEqual(["task-1"]);
    expect(stored).not.toHaveProperty("workspaces");
    expect(stored).not.toHaveProperty("git");
    expect(stored).not.toHaveProperty("agentRuntimes");
    expect(stored).not.toHaveProperty("hostId");
    const restarted = createSettingsConfigAdapter({ configPath, sharedSettings: database });
    const loaded = await Effect.runPromise(restarted.readConfig());
    expect(loaded!.git.defaultMergeMethod).toBe("squash");
    expect(loaded!.workspaces.first!.repoPath).toBe("/repo");
    expect(loaded!.theme).toBe("light");
    const global = await Effect.runPromise(restarted.readGlobalConfig());
    expect(global.theme).toBe("light");
    expect(global.git.defaultMergeMethod).toBe("squash");
    expect(global).not.toHaveProperty("workspaces");
    const workspace = await Effect.runPromise(restarted.readRepoConfig("first"));
    expect(workspace?.agentStudioState.openTaskIds).toEqual(["task-1"]);
    expect(
      (await Effect.runPromise(restarted.readRepoConfigByRepoPath("/repo")))?.workspaceId,
    ).toBe("first");
    expect(await Effect.runPromise(restarted.readRepoConfig("missing"))).toBeNull();
    const catalog = await Effect.runPromise(restarted.readWorkspaceCatalogSnapshot());
    expect(catalog.workspaces).toMatchObject([{ workspaceId: "first", repoPath: "/repo" }]);
    await Effect.runPromise(readSettingsConfigFile(configPath));
    const migration = await Effect.runPromise(
      loadLegacySettingsConfig(configPath, () =>
        Effect.die("Preferences cannot initialize shared settings"),
      ).pipe(Effect.result),
    );
    expect(migration._tag).toBe("Failure");
    if (migration._tag === "Failure")
      expect(migration.failure.message).toContain("Restore database.sqlite");
    const failing = createSettingsConfigAdapter({
      configPath,
      sharedSettings: {
        ...database,
        updateConfig: (change, workspaceIds) =>
          database.updateConfig(change, workspaceIds).pipe(
            Effect.tap(() =>
              Effect.promise(async () => {
                await unlink(configPath);
                await mkdir(configPath);
              }),
            ),
          ),
      },
    });
    const committed: SettingsConfigView[] = [];
    const observed = withConfigCommit(failing, (config) =>
      Effect.sync(() => {
        committed.push(config);
      }),
    );
    const result = await Effect.runPromise(
      observed.applyConfigChange(
        (current) => ({
          ...current,
          theme: "dark",
          git: { ...current.git, defaultMergeMethod: "rebase" },
        }),
        [],
      ),
    );
    expect(result.shared).toBe("saved");
    expect(result.config).toMatchObject({ git: { defaultMergeMethod: "rebase" }, theme: "light" });
    expect(committed[0]?.git.defaultMergeMethod).toBe("rebase");
    expect(committed[0]?.theme).toBe("light");
    expect(result.preferences).toHaveProperty("message");
    expect((await Effect.runPromise(database.readConfig()))!.git.defaultMergeMethod).toBe("rebase");
  } finally {
    await Effect.runPromise(manager.dispose());
    await rm(root, { recursive: true, force: true });
  }
});

test.each([2, 3, 4])("backs up version %s settings before writing preferences", async (version) => {
  const root = await mkdtemp(path.join(tmpdir(), "odt-settings-backup-"));
  const configPath = path.join(root, "config.json");
  const original =
    JSON.stringify(
      {
        version,
        theme: "dark",
        git: { defaultMergeMethod: "squash" },
        workspaces: { first: { agentStudioState: { openTaskIds: ["task-1"] } } },
      },
      null,
      4,
    ) + "\n";
  try {
    await writeFile(configPath, original);
    await Effect.runPromise(migrateSettingsConfig(configPath));
    expect(await readFile(`${configPath}.backup`, "utf8")).toBe(original);
    const preferences = JSON.parse(await readFile(configPath, "utf8"));
    expect(preferences).toMatchObject({
      version: 5,
      theme: "dark",
      workspaceUi: { first: { agentStudioState: { openTaskIds: ["task-1"] } } },
    });
    expect(preferences).not.toHaveProperty("git");
    expect(preferences).not.toHaveProperty("workspaces");
    // A second start after a downgrade that kept the file unchanged finishes the migration.
    await writeFile(configPath, original);
    await Effect.runPromise(migrateSettingsConfig(configPath));
    expect(await readFile(`${configPath}.backup`, "utf8")).toBe(original);
    expect(JSON.parse(await readFile(configPath, "utf8")).version).toBe(5);
    const saved = await readFile(configPath, "utf8");
    await Effect.runPromise(migrateSettingsConfig(configPath));
    expect(await readFile(configPath, "utf8")).toBe(saved);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.each([
  ["a downgrade changed the legacy file", "dark"],
  ["an unrelated backup exists", "unrelated"],
])("stops when %s and the backup differs", async (_case, backupTheme) => {
  const root = await mkdtemp(path.join(tmpdir(), "odt-settings-backup-conflict-"));
  const configPath = path.join(root, "config.json");
  const backupPath = `${configPath}.backup`;
  const legacy = (theme: string) => `${JSON.stringify({ version: 4, theme }, null, 2)}\n`;
  try {
    await writeFile(backupPath, legacy(backupTheme));
    await writeFile(configPath, legacy("light"));

    const error = await Effect.runPromise(Effect.flip(migrateSettingsConfig(configPath)));

    expect(error).toMatchObject({
      _tag: "SettingsFileError",
      reason: "backupConflict",
      path: configPath,
      backupPath,
    });
    expect(error.message).toContain(configPath);
    expect(error.message).toContain(backupPath);
    expect(error.message).toContain("older OpenDucktor version");
    expect(error.message).toContain("move one of them aside");
    expect(await readFile(configPath, "utf8")).toBe(legacy("light"));
    expect(await readFile(backupPath, "utf8")).toBe(legacy(backupTheme));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writes default preferences without a backup when no settings file exists", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "odt-settings-defaults-"));
  const configPath = path.join(root, "config.json");
  try {
    await Effect.runPromise(migrateSettingsConfig(configPath));
    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
      version: 5,
      theme: "system",
    });
    await expect(readFile(`${configPath}.backup`)).rejects.toMatchObject({ code: "ENOENT" });
    const saved = await readFile(configPath, "utf8");
    await Effect.runPromise(migrateSettingsConfig(configPath));
    expect(await readFile(configPath, "utf8")).toBe(saved);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
