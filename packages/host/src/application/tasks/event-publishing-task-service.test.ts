import { specPlanBuildReference } from "@openducktor/workflows/test-support";
import { createTaskEventStream } from "../../events/task-event-stream";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { noMergeDetection } from "./sync/task-sync-service.test-support";
import { describe, expect, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { Effect } from "effect";
import { collectTaskStatusChanges } from "../../ports/task-status-changes";
import { HostOperationError } from "../../effect/host-errors";
import { createEventPublishingTaskService } from "./event-publishing-task-service";
import { createTaskSyncService, type TaskSyncService } from "./sync/task-sync-service";
import {
  TaskMutationProgressFailure,
  TaskCreationProgressFailure,
} from "./task-mutation-progress-failure";
import type { TaskServiceWithMutationProgress } from "./task-service";
import { createTaskServiceWithMutationProgressTestDouble } from "../../test-support/task-service-test-double";

const taskCard = (): TaskCard => ({
  id: "task-1",
  title: "Task",
  description: "",
  status: "open",
  priority: 2,
  issueType: "task",
  removeWorktreeOnClose: null,
  workflow: specPlanBuildReference(),
  workflowSteps: [],
  availableActions: [],
  labels: [],
  artifactSummary: {
    spec: { present: false },
    plan: { present: false },
    qaReport: { present: false },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: false, completed: false },
    planner: { required: false, canSkip: true, available: false, completed: false },
    build: { required: true, canSkip: false, available: false, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});
const fakeTaskService = (
  overrides: Partial<TaskServiceWithMutationProgress>,
): TaskServiceWithMutationProgress =>
  createTaskServiceWithMutationProgressTestDouble({
    listTasks: () => Effect.succeed([]),
    ...overrides,
  });
const sync = (
  events: Array<{ changes: { taskIds: string[]; removedTaskIds: string[] } }>,
): Pick<
  TaskSyncService,
  | "runStatusMutation"
  | "publishExternalTaskCreated"
  | "publishTasksUpdated"
  | "syncRepoPullRequests"
  | "runMutation"
> => ({
  runMutation: (_repoPath, mutation) => mutation,
  runStatusMutation: (_repoPath, _operation, mutation, afterCommit) =>
    collectTaskStatusChanges(mutation).pipe(Effect.flatMap(afterCommit)),
  publishExternalTaskCreated: () => Effect.void,
  publishTasksUpdated: (_repoPath, changes) =>
    Effect.sync(() => {
      events.push({ changes });
      return { epoch: "11111111-1111-4111-8111-111111111111", sequence: 1 };
    }),
  syncRepoPullRequests: () =>
    Effect.succeed({ ran: true, changedTaskIds: [], autoCloseFailures: [] }),
});

describe("createEventPublishingTaskService", () => {
  test("passes the captured workspace to the gated sync and preserves its skip result", async () => {
    const calls: unknown[] = [];
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({}),
      taskSyncService: {
        ...sync([]),
        syncRepoPullRequests: (repoPath, expectedWorkspaceId) =>
          Effect.sync(() => {
            calls.push({ repoPath, expectedWorkspaceId });
            return {
              ran: false,
              changedTaskIds: [],
              reason: "workspace_closed",
              message: "Reopen the workspace.",
            };
          }),
      },
    });
    const input = {
      workspaceId: "workspace-1",
      repoPath: "/repo",
      expectedWorkspaceId: "workspace-1",
    };
    expect(await Effect.runPromise(service.repoPullRequestSync(input))).toEqual({
      ok: false,
      reason: "workspace_closed",
      message: "Reopen the workspace.",
    });
    expect(calls).toEqual([{ repoPath: "/repo", expectedWorkspaceId: "workspace-1" }]);
  });

  test("publishes a successful workflow artifact save once with its result changes", async () => {
    const plan = {
      artifact: { markdown: "# Plan" },
      changes: { taskIds: ["task-1"], removedTaskIds: [] },
    };
    const publications: Array<{ operation: string; taskIds: string[]; removedTaskIds: string[] }> =
      [];
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({ workflowArtifactSave: () => Effect.succeed(plan) }),
      taskSyncService: {
        ...sync([]),
        publishTasksUpdated: (_repoPath, changes, operation) =>
          Effect.sync(() => {
            publications.push({ operation, ...changes });
            return { epoch: "11111111-1111-4111-8111-111111111111", sequence: 1 };
          }),
      },
    });

    const result = await Effect.runPromise(
      service.workflowArtifactSave({
        sourceTool: "workflow_artifact_save",
        updatedBy: "user",
        workspaceId: "repo",
        repoPath: "/repo",
        taskId: "task-1",
        markdown: "# Plan",
        code: "plan",
        submit: true,
      }),
    );

    expect(result).toEqual({
      ...plan,
      artifact: {
        ...plan.artifact,
        cursor: { epoch: "11111111-1111-4111-8111-111111111111", sequence: 1 },
      },
    });
    expect(publications).toEqual([
      { operation: "save-workflow-artifact", taskIds: ["task-1"], removedTaskIds: [] },
    ]);
  });

  test("defers each workflow artifact save until execution inside the mutation gate", async () => {
    let gateActive = false;
    const calls: boolean[] = [];
    const taskSyncService = sync([]);
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({
        workflowArtifactSave: () => {
          calls.push(gateActive);
          return Effect.succeed({
            artifact: { markdown: "# Plan" },
            changes: { taskIds: ["task-1"], removedTaskIds: [] },
          });
        },
      }),
      taskSyncService: {
        ...taskSyncService,
        runStatusMutation: (_repoPath, _operation, mutation, afterCommit) =>
          Effect.gen(function* () {
            gateActive = true;
            const result = yield* collectTaskStatusChanges(mutation).pipe(
              Effect.flatMap(afterCommit),
            );
            gateActive = false;
            return result;
          }),
      },
    });
    const mutation = service.workflowArtifactSave({
      sourceTool: "workflow_artifact_save",
      updatedBy: "user",
      workspaceId: "repo",
      repoPath: "/repo",
      taskId: "task-1",
      markdown: "# Plan",
      code: "plan",
      submit: true,
    });

    expect(calls).toEqual([]);
    await Effect.runPromise(mutation);
    await Effect.runPromise(mutation);
    expect(calls).toEqual([true, true]);
  });

  test("separates a model save from publication and keeps the same publication rules", async () => {
    const events: Array<{ changes: { taskIds: string[]; removedTaskIds: string[] } }> = [];
    let saves = 0;
    let publications = 0;
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({
        agentSessionUpdateModel: () =>
          Effect.sync(() => {
            saves += 1;
            return true;
          }),
      }),
      taskSyncService: {
        ...sync(events),
        publishTasksUpdated: () =>
          Effect.sync(() => ({
            epoch: "11111111-1111-4111-8111-111111111111",
            sequence: ++publications,
          })),
      },
    });
    const input = {
      workspaceId: "repo",
      repoPath: "/repo",
      taskId: "task-1",
      identity: {
        externalSessionId: "session-1",
        runtimeKind: "codex" as const,
        workingDirectory: "/repo",
      },
      selectedModel: { runtimeKind: "codex" as const, providerId: "openai", modelId: "model" },
    };
    const saved = await Effect.runPromise(
      service.agentSessionUpdateModelDeferredPublication(input),
    );
    expect(saved.updated).toBe(true);
    expect(saves).toBe(1);
    expect(publications).toBe(0);
    await Effect.runPromise(saved.publish);
    expect(publications).toBe(1);
    await Effect.runPromise(service.agentSessionUpdateModel(input));
    expect(saves).toBe(2);
    expect(publications).toBe(2);
  });

  test("does not publish a failed model save", async () => {
    const events: Array<{ changes: { taskIds: string[]; removedTaskIds: string[] } }> = [];
    const failure = new HostOperationError({ operation: "model-save", message: "Save failed" });
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({ agentSessionUpdateModel: () => Effect.fail(failure) }),
      taskSyncService: sync(events),
    });
    const result = await Effect.runPromise(
      service
        .agentSessionUpdateModelDeferredPublication({
          workspaceId: "repo",
          repoPath: "/repo",
          taskId: "task-1",
          identity: {
            externalSessionId: "session-1",
            runtimeKind: "codex",
            workingDirectory: "/repo",
          },
          selectedModel: null,
        })
        .pipe(Effect.flip),
    );
    expect(result).toBe(failure);
    expect(events).toEqual([]);
  });

  test.each(["updateTask", "directMerge", "workflowArtifactSave"] as const)(
    "preserves the %s failure when snapshot publication also fails",
    async (method) => {
      const mutationFailure = new HostOperationError({
        operation: method,
        message: "Committed work still needs cleanup.",
      });
      const snapshotFailure = new HostOperationError({
        operation: "task.list",
        message: "Snapshot unavailable",
      });
      const progress = new TaskMutationProgressFailure({
        operation: "update-task",
        changes: { taskIds: ["task-1"], removedTaskIds: [] },
        failure: mutationFailure,
      });
      const base = fakeTaskService({
        updateTask: () => Effect.fail(progress),
        directMerge: () => Effect.fail(progress),
        workflowArtifactSave: () => Effect.fail(progress),
        listTasks: () => Effect.fail(snapshotFailure),
      });
      const stream = createTaskEventStream({ reporter: { report: () => {} } });
      const taskSyncService = createTaskSyncService({
        taskService: base,
        mergeDetection: noMergeDetection,
        taskEventStream: stream,
        publicationReporter: { report: () => Effect.void },
        onBackgroundFailure: () => Effect.void,
        settingsConfig: {
          readGlobalConfig: () => Effect.succeed(createDefaultGlobalConfig()),
        },
        workspaceSettingsService: {
          getWorkspaceCatalog: () =>
            Effect.succeed({
              catalogRevision: 0,
              openWorkspaces: [],
              closedWorkspaces: [],
              incompleteRemovals: [],
            }),
          listWorkspaces: () => Effect.succeed([]),
        },
      });
      const service = createEventPublishingTaskService({
        taskService: base,
        taskSyncService,
      });
      const calls = {
        updateTask: service
          .updateTask({ workspaceId: "repo", repoPath: "/repo", taskId: "task-1", patch: {} })
          .pipe(Effect.asVoid),
        directMerge: service
          .directMerge({
            workspaceId: "repo",
            repoPath: "/repo",
            taskId: "task-1",
            input: {
              removeWorktree: true,
              mergeMethod: "merge_commit",
              expected: {
                taskStatus: "human_review",
                sourceBranch: "odt/task-1",
                targetBranch: { branch: "main" },
              },
            },
          })
          .pipe(Effect.asVoid),
        workflowArtifactSave: service
          .workflowArtifactSave({
            sourceTool: "workflow_artifact_save",
            updatedBy: "user",
            workspaceId: "repo",
            repoPath: "/repo",
            taskId: "task-1",
            code: "plan",
            markdown: "Plan",
            submit: true,
          })
          .pipe(Effect.asVoid),
      };
      const failure = await Effect.runPromise(calls[method].pipe(Effect.flip));
      expect(failure.message).toContain(mutationFailure.message);
      expect(failure.message).toContain("Reload the workspace");
      expect(failure).toMatchObject({
        cause: { mutationFailure, snapshotFailure },
        details: { durableState: "committed" },
      });
    },
  );

  test("returns committed create and update results after publication acceptance failures", async () => {
    const reports: unknown[] = [];
    const taskSyncService: Pick<
      TaskSyncService,
      | "runStatusMutation"
      | "publishExternalTaskCreated"
      | "publishTasksUpdated"
      | "syncRepoPullRequests"
      | "runMutation"
    > = {
      ...sync([]),
      publishExternalTaskCreated: () => Effect.void,
      publishTasksUpdated: () =>
        Effect.sync(() => {
          reports.push("acceptance failure reported");
          return { epoch: "11111111-1111-4111-8111-111111111111", sequence: 1 };
        }),
      syncRepoPullRequests: () =>
        Effect.succeed({ ran: true, changedTaskIds: [], autoCloseFailures: [] }),
    };
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({
        createTask: () => Effect.succeed(taskCard()),
        updateTask: () => Effect.succeed(taskCard()),
      }),
      taskSyncService,
    });
    await expect(
      Effect.runPromise(
        service.createTask({
          workspaceId: "repo",
          repoPath: "/repo",
          task: { title: "Task", issueType: "task", priority: 2 },
        }),
      ),
    ).resolves.toEqual(taskCard());
    await expect(
      Effect.runPromise(
        service.updateTask({ workspaceId: "repo", repoPath: "/repo", taskId: "task-1", patch: {} }),
      ),
    ).resolves.toEqual(taskCard());
    expect(reports).toEqual(["acceptance failure reported"]);
  });
  test("publishes a committed create before returning its cleanup failure", async () => {
    const publishedTaskIds: string[] = [];
    const failure = new HostOperationError({
      operation: "create-task",
      message: "Asset cleanup failed.",
    });
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({
        createTask: () =>
          Effect.fail(
            new TaskCreationProgressFailure(
              {
                workflow: specPlanBuildReference(),
                id: "task-1",
                title: "Created",
                status: "open",
              },
              failure,
            ),
          ),
      }),
      taskSyncService: {
        runMutation: (_repoPath, mutation) => mutation,
        runStatusMutation: (_repoPath, _operation, mutation, afterCommit) =>
          collectTaskStatusChanges(mutation).pipe(Effect.flatMap(afterCommit)),
        publishExternalTaskCreated: (_repoPath, taskSnapshot) =>
          Effect.sync(() => {
            publishedTaskIds.push(taskSnapshot.id);
          }),
        publishTasksUpdated: () => Effect.die(new Error("unexpected task update publication")),
        syncRepoPullRequests: () =>
          Effect.succeed({ ran: true, changedTaskIds: [], autoCloseFailures: [] }),
      },
    });

    await expect(
      Effect.runPromise(
        service
          .createTask({
            workspaceId: "repo",
            repoPath: "/repo",
            task: { title: "Task", issueType: "task", priority: 2 },
          })
          .pipe(Effect.flip),
      ),
    ).resolves.toBe(failure);
    expect(publishedTaskIds).toEqual(["task-1"]);
  });
  test("publishes generic mutation partial progress and preserves the original failure", async () => {
    const events: Array<{ changes: { taskIds: string[]; removedTaskIds: string[] } }> = [];
    const failure = new HostOperationError({
      operation: "link-merged-pull-request",
      message: "closure failed",
    });
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({
        linkMergedPullRequest: () =>
          Effect.fail(
            new TaskMutationProgressFailure({
              operation: "link-merged-pull-request",
              changes: { taskIds: ["task-1"], removedTaskIds: [] },
              failure,
            }),
          ),
      }),
      taskSyncService: sync(events),
    });

    await expect(
      Effect.runPromise(
        service
          .linkMergedPullRequest({
            workspaceId: "repo",
            repoPath: "/repo",
            taskId: "task-1",
            removeWorktree: true,
            pullRequest: {
              providerId: "pr-1",
              number: 1,
              url: "https://example.test/pull/1",
              state: "merged",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          })
          .pipe(Effect.flip),
      ),
    ).resolves.toBe(failure);
    expect(events).toEqual([{ changes: { taskIds: ["task-1"], removedTaskIds: [] } }]);
  });
  test("publishes conditional mutation partial progress and preserves the original failure", async () => {
    const events: Array<{ changes: { taskIds: string[]; removedTaskIds: string[] } }> = [];
    const failure = new HostOperationError({
      operation: "direct-merge",
      message: "closure failed",
    });
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({
        directMerge: () =>
          Effect.fail(
            new TaskMutationProgressFailure({
              operation: "direct-merge",
              changes: { taskIds: ["task-1"], removedTaskIds: [] },
              failure,
            }),
          ),
      }),
      taskSyncService: sync(events),
    });

    await expect(
      Effect.runPromise(
        service
          .directMerge({
            workspaceId: "repo",
            repoPath: "/repo",
            taskId: "task-1",
            input: {
              removeWorktree: true,
              mergeMethod: "merge_commit",
              expected: {
                taskStatus: "human_review",
                sourceBranch: "odt/task-1",
                targetBranch: { branch: "main" },
              },
            },
          })
          .pipe(Effect.flip),
      ),
    ).resolves.toBe(failure);
    expect(events).toEqual([{ changes: { taskIds: ["task-1"], removedTaskIds: [] } }]);
  });
  test("does not publish an update when the task is missing", async () => {
    const events: Array<{ changes: { taskIds: string[]; removedTaskIds: string[] } }> = [];
    const failure = new HostOperationError({
      operation: "update-task",
      message: "Task task-1 not found",
    });
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({
        updateTask: () => Effect.fail(failure),
      }),
      taskSyncService: sync(events),
    });

    await expect(
      Effect.runPromise(
        service
          .updateTask({ workspaceId: "repo", repoPath: "/repo", taskId: "task-1", patch: {} })
          .pipe(Effect.flip),
      ),
    ).resolves.toBe(failure);
    expect(events).toEqual([]);
  });
  test("does not publish when deleting a task fails", async () => {
    const events: Array<{ changes: { taskIds: string[]; removedTaskIds: string[] } }> = [];
    const failure = new HostOperationError({
      operation: "delete-task",
      message: "Delete failed",
    });
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({
        deleteTask: () => Effect.fail(failure),
      }),
      taskSyncService: sync(events),
    });

    await expect(
      Effect.runPromise(
        service
          .deleteTask({ workspaceId: "repo", repoPath: "/repo", taskId: "task-1" })
          .pipe(Effect.flip),
      ),
    ).resolves.toBe(failure);
    expect(events).toEqual([]);
  });
  test("does not publish when pull request detection fails", async () => {
    const events: Array<{ changes: { taskIds: string[]; removedTaskIds: string[] } }> = [];
    const failure = new HostOperationError({
      operation: "detect-pull-request",
      message: "Detection failed",
    });
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({
        detectPullRequest: () => Effect.fail(failure),
      }),
      taskSyncService: sync(events),
    });

    await expect(
      Effect.runPromise(
        service
          .detectPullRequest({ workspaceId: "repo", repoPath: "/repo", taskId: "task-1" })
          .pipe(Effect.flip),
      ),
    ).resolves.toBe(failure);
    expect(events).toEqual([]);
  });
  test("does not publish ordinary workflow artifact save failures", async () => {
    const events: Array<{ changes: { taskIds: string[]; removedTaskIds: string[] } }> = [];
    const failure = new HostOperationError({
      operation: "save-workflow-artifact",
      message: "Artifact write failed",
    });
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({
        workflowArtifactSave: () => Effect.fail(failure),
      }),
      taskSyncService: sync(events),
    });

    await expect(
      Effect.runPromise(
        service
          .workflowArtifactSave({
            sourceTool: "workflow_artifact_save",
            updatedBy: "user",
            workspaceId: "repo",
            repoPath: "/repo",
            taskId: "task-1",
            markdown: "# Plan",
            code: "plan",
            submit: true,
          })
          .pipe(Effect.flip),
      ),
    ).resolves.toBe(failure);
    expect(events).toEqual([]);
  });
  test("publishes deleted task ids as removed", async () => {
    const events: Array<{ changes: { taskIds: string[]; removedTaskIds: string[] } }> = [];
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({
        deleteTask: () =>
          Effect.succeed({
            ok: true,
            changes: { taskIds: ["task-1"], removedTaskIds: ["task-1"] },
          }),
      }),
      taskSyncService: sync(events),
    });
    await Effect.runPromise(
      service.deleteTask({ workspaceId: "repo", repoPath: "/repo", taskId: "task-1" }),
    );
    expect(events).toEqual([{ changes: { taskIds: ["task-1"], removedTaskIds: ["task-1"] } }]);
  });
});
