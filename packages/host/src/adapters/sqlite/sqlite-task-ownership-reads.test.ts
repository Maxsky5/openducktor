import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { createAgentSessionRecord } from "../../ports/task-store-port-contract.test-support";
import { workspaces } from "./sqlite-host-settings-schema";
import { createSqliteTaskStoreHarness, insertRawTask } from "./sqlite-task-store-test-support";

test("a closed workspace still reports its open tasks and session directories", async () => {
  const harness = await createSqliteTaskStoreHarness();
  const scope = { workspaceId: "fairnest", repoPath: harness.repoPath };
  try {
    await Effect.runPromise(harness.store.listTaskIds(scope));
    insertRawTask({
      databasePath: harness.databasePath,
      taskId: "open",
      agentSessionsJson: JSON.stringify([
        createAgentSessionRecord({ workingDirectory: " /trees/a " }),
      ]),
    });
    insertRawTask({
      databasePath: harness.databasePath,
      taskId: "done",
      status: "closed",
      agentSessionsJson: JSON.stringify([
        createAgentSessionRecord({ workingDirectory: "/trees/b" }),
      ]),
    });
    await Effect.runPromise(
      harness.withHostDatabase("test.closeWorkspace", (session) =>
        session.execute(
          (db) =>
            db
              .update(workspaces)
              .set({ closed: true })
              .where(eq(workspaces.workspaceId, scope.workspaceId)),
          "test.closeWorkspace",
        ),
      ),
    );
    await expect(Effect.runPromise(harness.store.listTasks(scope))).rejects.toThrow(
      "Workspace is closed",
    );
    expect(
      await Effect.runPromise(
        harness.taskOwnership.listOpenTasksForWorktreeOwnership({ workspaces: [scope] }),
      ),
    ).toEqual([
      {
        workspaceId: scope.workspaceId,
        taskId: "open",
        title: "Task",
        sessionDirectories: ["/trees/a"],
      },
    ]);
  } finally {
    await harness.cleanup();
  }
});
