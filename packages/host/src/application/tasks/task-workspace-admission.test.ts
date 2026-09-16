import { describe, expect, test } from "bun:test";
import { taskCardSchema } from "@openducktor/contracts";
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

  test("holds the ownership lock through merge cleanup", async () => {
    const events: string[] = [];
    const ownershipLock: WorkspaceOwnershipLock = {
      runExclusive: (effect) =>
        Effect.acquireUseRelease(
          Effect.sync(() => events.push("lock")),
          () => effect,
          () => Effect.sync(() => events.push("unlock")),
        ),
    };
    const operation = <A>(name: string, result: A) =>
      Effect.sync(() => {
        events.push(name);
        return result;
      });
    const mergedTask = taskCardSchema.parse({
      id: "task-1",
      title: "Task 1",
      status: "closed",
      issueType: "task",
      createdAt: "2026-09-16T00:00:00.000Z",
      updatedAt: "2026-09-16T00:00:00.000Z",
    });
    const service = withTaskWorkspaceOwnership(
      createTaskServiceWithMutationProgressTestDouble({
        completeDirectMerge: () => operation("complete-direct-merge", mergedTask),
        directMerge: () =>
          operation("direct-merge", { outcome: "completed" as const, task: mergedTask }),
        linkMergedPullRequest: () => operation("link-merged-pull-request", mergedTask),
        repoPullRequestSync: () => operation("repo-pull-request-sync", { ok: true }),
        repoPullRequestSyncDetailed: () =>
          operation("repo-pull-request-sync-detailed", { ran: true, changedTaskIds: [] }),
      }),
      ownershipLock,
    );

    await Effect.runPromise(service.completeDirectMerge({ repoPath: "/repo", taskId: "task-1" }));
    await Effect.runPromise(
      service.directMerge({
        repoPath: "/repo",
        taskId: "task-1",
        input: { mergeMethod: "merge_commit" },
      }),
    );
    await Effect.runPromise(
      service.linkMergedPullRequest({
        repoPath: "/repo",
        taskId: "task-1",
        pullRequest: {
          providerId: "github",
          number: 1,
          url: "https://github.com/openai/openducktor/pull/1",
          state: "merged",
          createdAt: "2026-09-16T00:00:00.000Z",
          updatedAt: "2026-09-16T00:00:00.000Z",
        },
      }),
    );
    await Effect.runPromise(service.repoPullRequestSync({ repoPath: "/repo" }));
    await Effect.runPromise(service.repoPullRequestSyncDetailed({ repoPath: "/repo" }));

    expect(events).toEqual([
      "lock",
      "complete-direct-merge",
      "unlock",
      "lock",
      "direct-merge",
      "unlock",
      "lock",
      "link-merged-pull-request",
      "unlock",
      "lock",
      "repo-pull-request-sync",
      "unlock",
      "lock",
      "repo-pull-request-sync-detailed",
      "unlock",
    ]);
  });
});
