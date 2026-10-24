import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import { createWorkspaceAdmissionService } from "../../application/workspaces/workspace-admission-service";
import { createAgentSessionRecord } from "../../ports/task-store-port-contract.test-support";
import { createSqliteTaskRepository } from "./sqlite-task-repository";
import { createSqliteTaskRepositoryContextManager } from "./sqlite-task-repository-context";
import {
  createSqliteTaskStoreHarness,
  insertRawTask,
  openSqliteTaskStoreTestConnection,
  type SqliteTaskStoreTestHarness,
} from "./sqlite-task-store-test-support";
import { resolveSqliteTaskStoreDatabasePath } from "../../infrastructure/sqlite/sqlite-task-store-path";

let harness: SqliteTaskStoreTestHarness;
beforeEach(async () => {
  harness = await createSqliteTaskStoreHarness();
});
afterEach(async () => {
  await harness.cleanup();
});

test("a closed workspace still reports its open tasks and their session directories", async () => {
  const repoPath = path.join(harness.configDir, "closed-repo");
  await mkdir(repoPath);
  const scope = { workspaceId: "closed-owner", repoPath };
  const admission = createWorkspaceAdmissionService({
    workspaceSettingsService: {
      getWorkspaceCatalog: () =>
        Effect.succeed({ openWorkspaces: [], closedWorkspaces: [], incompleteRemovals: [] }),
    },
  });
  const manager = createSqliteTaskRepositoryContextManager({
    configDir: harness.configDir,
    processEnv: {},
    openConnection: openSqliteTaskStoreTestConnection,
    assertWorkspaceAdmitted: admission.assertTaskStoreAccess,
    assertWorkspaceOwnershipReadAdmitted: (input) =>
      admission.assertTaskStoreOwnershipReadAccess({ ...input, operation: "test.worktreeOwners" }),
    resolveWorkspaceIdForRepoPath: () => Effect.succeed(scope.workspaceId),
  });
  const tasks = createSqliteTaskRepository({ contextProvider: manager.withDatabase });
  try {
    expect(await Effect.runPromise(manager.listOpenTasksForWorktreeOwnership(scope))).toEqual([]);
    const databasePath = Effect.runSync(
      resolveSqliteTaskStoreDatabasePath({
        configDir: harness.configDir,
        workspaceId: scope.workspaceId,
      }),
    );
    const sessionsJson = (workingDirectory: string) =>
      JSON.stringify([createAgentSessionRecord({ workingDirectory })]);
    insertRawTask({ databasePath, taskId: "open", agentSessionsJson: sessionsJson(" /trees/a ") });
    insertRawTask({
      databasePath,
      taskId: "done",
      status: "closed",
      agentSessionsJson: sessionsJson("/trees/b"),
    });

    admission.blockWorkspace({ ...scope, reason: "closed" });

    await expect(Effect.runPromise(tasks.listTasks({ repoPath }))).rejects.toThrow(
      "Workspace is closed",
    );
    expect(await Effect.runPromise(manager.listOpenTasksForWorktreeOwnership(scope))).toEqual([
      { taskId: "open", title: "Task", sessionDirectories: ["/trees/a"] },
    ]);
  } finally {
    await Effect.runPromise(manager.dispose());
  }
});
