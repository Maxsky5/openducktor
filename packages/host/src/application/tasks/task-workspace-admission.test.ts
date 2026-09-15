import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createTaskServiceWithMutationProgressTestDouble } from "../../test-support/task-service-test-double";
import type { WorkspaceOwnershipLock } from "../workspaces/workspace-ownership-lock";
import { withTaskWorkspaceOwnership, withWorkspaceAdmission } from "./task-workspace-admission";

describe("task workspace admission", () => {
  test("holds the ownership lock through task worktree setup and cleanup", async () => {
    const events: string[] = [];
    const ownershipLock: WorkspaceOwnershipLock = {
      runExclusive: (effect) =>
        Effect.acquireUseRelease(
          Effect.sync(() => events.push("lock")),
          () => effect,
          () => Effect.sync(() => events.push("unlock")),
        ),
    };
    const admitted = withWorkspaceAdmission(
      createTaskServiceWithMutationProgressTestDouble({
        buildStart: () =>
          Effect.sync(() => {
            events.push("build-start");
            return { runtimeKind: "opencode" as const, workingDirectory: "/worktree" };
          }),
        deleteTask: () =>
          Effect.sync(() => {
            events.push("delete");
            return { ok: true, changes: { taskIds: ["task-1"], removedTaskIds: ["task-1"] } };
          }),
      }),
      {
        withWorkStartLease: (_repoPath, effect) =>
          Effect.acquireUseRelease(
            Effect.sync(() => events.push("lease")),
            () => effect,
            () => Effect.sync(() => events.push("release-lease")),
          ),
      },
    );
    const service = withTaskWorkspaceOwnership(admitted, ownershipLock);

    await Effect.runPromise(
      service.deleteTask({ repoPath: "/repo", taskId: "task-1", deleteSubtasks: false }),
    );
    await Effect.runPromise(
      service.buildStart({ repoPath: "/repo", taskId: "task-1", runtimeKind: "opencode" }),
    );

    expect(events).toEqual([
      "lock",
      "lease",
      "delete",
      "release-lease",
      "unlock",
      "lock",
      "lease",
      "build-start",
      "release-lease",
      "unlock",
    ]);
  });
});
