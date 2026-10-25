import { Effect } from "effect";
import type {
  BuildSessionBootstrap,
  PullRequest,
  TaskApprovalContextLoadResult,
  TaskCard,
  TaskDirectMergeResult,
  TaskMetadataArtifact,
  TaskMetadataPayload,
  TaskPullRequestDetectResult,
} from "@openducktor/contracts";
import { createTaskServiceTestDouble } from "../../test-support/task-service-test-double";
import { HostOperationError } from "../../effect/host-errors";
import { createTaskCommandHandlers } from "./task-command-handlers";
import type { HostCommandHandlerError } from "../router/host-command-router";

type TaskCommandService = Parameters<typeof createTaskCommandHandlers>[0];
const createTaskCommandService = (overrides: Partial<TaskCommandService>): TaskCommandService => ({
  ...createTaskServiceTestDouble({}),
  ...overrides,
});

const taskFixture: TaskCard = {
  id: "task-1",
  title: "Task",
  description: "",
  status: "open",
  priority: 2,
  issueType: "task",
  availableActions: [],
  labels: [],
  pullRequest: undefined,
  artifactSummary: {
    spec: { present: false },
    plan: { present: false },
    qaReport: { present: false },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    build: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-05-10T10:00:00.000Z",
  createdAt: "2026-05-10T10:00:00.000Z",
};

const artifactFixture: TaskMetadataArtifact = { markdown: "# Fixture" };
const pullRequestFixture: PullRequest = {
  providerId: "github",
  number: 1,
  url: "https://github.com/acme/repo/pull/1",
  state: "open",
  createdAt: "2026-05-10T10:00:00.000Z",
  updatedAt: "2026-05-10T10:00:00.000Z",
};
const approvalContextFixture: TaskApprovalContextLoadResult = {
  outcome: "missing_builder_worktree",
  taskId: taskFixture.id,
  taskStatus: taskFixture.status,
};
const pullRequestDetectionFixture: TaskPullRequestDetectResult = {
  outcome: "not_found",
  sourceBranch: "feature/task-1",
  targetBranch: "main",
};
const directMergeFixture: TaskDirectMergeResult = {
  outcome: "completed",
  task: taskFixture,
};
const metadataFixture: TaskMetadataPayload = {
  artifacts: { spec: artifactFixture, plan: artifactFixture },
  agentSessions: [],
};
const buildSessionFixture: BuildSessionBootstrap = {
  runtimeKind: "opencode",
  workingDirectory: "/repo/task-1",
};

const runHandler = <T>(
  effect: Effect.Effect<T, HostCommandHandlerError> | undefined,
): Promise<T> => {
  if (!effect) {
    throw new Error("Expected task command handler to be registered");
  }
  return Effect.runPromise(effect);
};

describe("createTaskCommandHandlers", () => {
  test("keeps the complete task read separate from Kanban retention", async () => {
    const closed = { ...taskFixture, status: "closed" as const };
    const calls: unknown[] = [];
    const handlers = createTaskCommandHandlers(
      createTaskCommandService({
        listKanbanTasks: () => Effect.succeed([]),
        listTasks: (input) => {
          calls.push(input);
          return Effect.succeed([closed]);
        },
      }),
    );
    expect(await runHandler(handlers.tasks_list({ repoPath: "/repo" }))).toEqual([]);
    expect(await runHandler(handlers.tasks_list_all({ repoPath: "/repo" }))).toEqual([closed]);
    expect(calls).toEqual([{ repoPath: "/repo" }]);
    expect(() => handlers.tasks_list_all({})).toThrow("repoPath is required.");
  });
  test.each([
    { repoPath: " " },
    { repoPath: "/repo", expectedWorkspaceId: " " },
    { repoPath: "/repo", expectedWorkspaceId: 42 },
  ])("rejects invalid manual sync input before dispatch: %j", (input) => {
    let dispatched = false;
    const handlers = createTaskCommandHandlers(
      createTaskCommandService({
        repoPullRequestSync: () => {
          dispatched = true;
          return Effect.succeed({ ok: true });
        },
      }),
    );
    expect(() => handlers.repo_pull_request_sync(input)).toThrow(
      "repo_pull_request_sync input is invalid",
    );
    expect(dispatched).toBe(false);
  });
  test("registers task_ids_list for the IDs of all tasks of a repository", async () => {
    const inputs: unknown[] = [];
    const handlers = createTaskCommandHandlers(
      createTaskCommandService({
        listTaskIds(input) {
          return Effect.sync(() => {
            inputs.push(input);
            return ["task-1", "task-2"];
          });
        },
      }),
    );

    await expect(runHandler(handlers.task_ids_list?.({ repoPath: "/repo" }))).resolves.toEqual([
      "task-1",
      "task-2",
    ]);
    expect(inputs).toEqual([{ repoPath: "/repo" }]);
    expect(() => handlers.task_ids_list?.({})).toThrow("repoPath is required.");
  });

  test("registers tasks_list", async () => {
    const calls: unknown[] = [];
    const service = createTaskCommandService({
      agentSessionDelete(input) {
        return Effect.sync(() => {
          calls.push({ command: "agent_session_delete", input });
          return true;
        });
      },
      agentSessionsList(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "agent_sessions_list", input });
            return [];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      agentSessionsListForTasks(input) {
        return Effect.sync(() => {
          calls.push({ command: "agent_sessions_list_for_tasks", input });
          return [];
        });
      },
      getApprovalContext(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_approval_context_get", input });
            return approvalContextFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      detectPullRequest(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_pull_request_detect", input });
            return pullRequestDetectionFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      unlinkPullRequest(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_pull_request_unlink", input });
            return true;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      upsertPullRequest(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_pull_request_upsert", input });
            return pullRequestFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      directMerge(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_direct_merge", input });
            return directMergeFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      completeDirectMerge(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_direct_merge_complete", input });
            return taskFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      linkMergedPullRequest(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_pull_request_link_merged", input });
            return taskFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      buildBlocked(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "build_blocked", input });
            return taskFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      buildStart(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "build_start", input });
            return buildSessionFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      buildCompleted(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "build_completed", input });
            return taskFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      buildResumed(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "build_resumed", input });
            return taskFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      createTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_create", input });
            return taskFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_delete", input });
            return { ok: true, changes: { taskIds: ["task-1"], removedTaskIds: ["task-1"] } };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      closeTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_close", input });
            return taskFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      resetImplementation(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_reset_implementation", input });
            return taskFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      resetTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_reset", input });
            return taskFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      listKanbanTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "tasks_list", input });
            return [];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTaskMetadata(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_metadata_get", input });
            return metadataFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      humanApprove(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "human_approve", input });
            return taskFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      humanRequestChanges(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "human_request_changes", input });
            return taskFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      workflowArtifactGet(input) {
        return Effect.sync(() => {
          calls.push({ command: "workflow_artifact_get", input });
          return artifactFixture;
        });
      },
      workflowArtifactSave(input) {
        return Effect.sync(() => {
          calls.push({ command: "workflow_artifact_save", input });
          return {
            artifact: artifactFixture,
            changes: { taskIds: [input.taskId], removedTaskIds: [] },
          };
        });
      },
      repoPullRequestSync(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "repo_pull_request_sync", input });
            return { ok: true as const };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      repoPullRequestSyncDetailed(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "repo_pull_request_sync_detailed", input });
            return { ran: true as const, changedTaskIds: [] };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_transition", input });
            return taskFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      applyTaskEvent(input) {
        calls.push({ command: "task_apply_event", input });
        return Effect.succeed(taskFixture);
      },
      updateTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_update", input });
            return taskFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    });
    const handlers = createTaskCommandHandlers(service);
    await expect(runHandler(handlers.tasks_list?.({ repoPath: "/repo" }))).resolves.toEqual([]);
    await expect(
      runHandler(
        handlers.task_create?.({
          repoPath: "/repo",
          input: { title: "Task", issueType: "task", priority: 2 },
        }),
      ),
    ).resolves.toBeDefined();
    await expect(
      runHandler(handlers.task_delete?.({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toEqual({ ok: true });
    await expect(
      runHandler(handlers.task_close?.({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toBeDefined();
    await expect(
      runHandler(handlers.task_reset_implementation?.({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toBeDefined();
    await expect(
      runHandler(handlers.task_reset?.({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toBeDefined();
    await expect(
      runHandler(handlers.task_metadata_get?.({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toBeDefined();
    await expect(
      runHandler(
        handlers.agent_session_delete?.({
          repoPath: "/repo",
          taskId: "task-1",
          identity: {
            externalSessionId: "session-1",
            runtimeKind: "opencode",
            workingDirectory: "/repo/task-1",
          },
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      runHandler(handlers.agent_sessions_list?.({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toEqual([]);
    await expect(
      runHandler(
        handlers.agent_sessions_list_for_tasks?.({
          repoPath: "/repo",
          taskIds: ["task-2", "task-1", "task-2"],
        }),
      ),
    ).resolves.toEqual([]);
    await expect(
      runHandler(handlers.task_approval_context_get?.({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toBeDefined();
    await expect(
      runHandler(handlers.task_pull_request_detect?.({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toBeDefined();
    await expect(
      runHandler(handlers.task_pull_request_unlink?.({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toBe(true);
    await expect(
      runHandler(
        handlers.task_pull_request_upsert?.({
          repoPath: "/repo",
          taskId: "task-1",
          input: { title: "PR", body: "Body" },
        }),
      ),
    ).resolves.toBeDefined();
    await expect(
      runHandler(
        handlers.task_direct_merge?.({
          repoPath: "/repo",
          taskId: "task-1",
          input: {
            mergeMethod: "merge_commit",
            expected: {
              taskStatus: "human_review",
              sourceBranch: "odt/task-1",
              targetBranch: { branch: "main" },
            },
          },
        }),
      ),
    ).resolves.toBeDefined();
    await expect(
      runHandler(handlers.task_direct_merge_complete?.({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toBeDefined();
    await expect(
      runHandler(
        handlers.task_pull_request_link_merged?.({
          repoPath: "/repo",
          taskId: "task-1",
          pullRequest: {
            providerId: "github",
            number: 12,
            url: "https://github.com/acme/repo/pull/12",
            state: "merged",
            createdAt: "2026-05-10T10:00:00.000Z",
            updatedAt: "2026-05-10T11:00:00.000Z",
          },
        }),
      ),
    ).resolves.toBeDefined();
    await expect(
      runHandler(
        handlers.task_transition?.({ repoPath: "/repo", taskId: "task-1", status: "in_progress" }),
      ),
    ).resolves.toBeDefined();
    await expect(
      runHandler(
        handlers.task_apply_event?.({ repoPath: "/repo", taskId: "task-1", eventId: "defer" }),
      ),
    ).resolves.toBeDefined();
    await expect(
      runHandler(
        handlers.build_blocked?.({ repoPath: "/repo", taskId: "task-1", reason: "Blocked" }),
      ),
    ).resolves.toBeDefined();
    await expect(
      runHandler(
        handlers.build_start?.({ repoPath: "/repo", taskId: "task-1", runtimeKind: "opencode" }),
      ),
    ).resolves.toBeDefined();
    await expect(
      runHandler(handlers.build_resumed?.({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toBeDefined();
    await expect(
      runHandler(
        handlers.build_completed?.({
          repoPath: "/repo",
          taskId: "task-1",
          input: { summary: "Done" },
        }),
      ),
    ).resolves.toBeDefined();
    await expect(
      runHandler(
        handlers.task_update?.({ repoPath: "/repo", taskId: "task-1", patch: { title: "Task" } }),
      ),
    ).resolves.toBeDefined();
    await expect(
      runHandler(
        handlers.repo_pull_request_sync?.({ repoPath: "/repo", expectedWorkspaceId: "repo-id" }),
      ),
    ).resolves.toEqual({ ok: true });
    await expect(
      runHandler(
        handlers.human_request_changes?.({
          repoPath: "/repo",
          taskId: "task-1",
          note: "Please adjust",
        }),
      ),
    ).resolves.toBeDefined();
    await expect(
      runHandler(handlers.human_approve?.({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toBeDefined();
    await expect(
      runHandler(
        handlers.workflow_artifact_save?.({
          repoPath: "/repo",
          taskId: "task-1",
          code: "qaReport",
          markdown: "Looks good",
          verdict: "approved",
          submit: true,
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
        }),
      ),
    ).resolves.toEqual(artifactFixture);
    await expect(
      runHandler(
        handlers.workflow_artifact_save?.({
          repoPath: "/repo",
          taskId: "task-1",
          code: "spec",
          markdown: "# Spec",
          submit: false,
        }),
      ),
    ).resolves.toEqual(artifactFixture);
    await expect(
      runHandler(
        handlers.workflow_artifact_get?.({ repoPath: "/repo", taskId: "task-1", code: "plan" }),
      ),
    ).resolves.toEqual(artifactFixture);
    expect(calls).toEqual([
      { command: "tasks_list", input: { repoPath: "/repo" } },
      {
        command: "task_create",
        input: {
          repoPath: "/repo",
          task: { title: "Task", issueType: "task", priority: 2 },
        },
      },
      {
        command: "task_delete",
        input: { repoPath: "/repo", taskId: "task-1" },
      },
      {
        command: "task_close",
        input: { repoPath: "/repo", taskId: "task-1" },
      },
      {
        command: "task_reset_implementation",
        input: { repoPath: "/repo", taskId: "task-1" },
      },
      {
        command: "task_reset",
        input: { repoPath: "/repo", taskId: "task-1" },
      },
      {
        command: "task_metadata_get",
        input: { repoPath: "/repo", taskId: "task-1" },
      },
      {
        command: "agent_session_delete",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          identity: {
            externalSessionId: "session-1",
            runtimeKind: "opencode",
            workingDirectory: "/repo/task-1",
          },
        },
      },
      {
        command: "agent_sessions_list",
        input: { repoPath: "/repo", taskId: "task-1" },
      },
      {
        command: "agent_sessions_list_for_tasks",
        input: { repoPath: "/repo", taskIds: ["task-2", "task-1"] },
      },
      {
        command: "task_approval_context_get",
        input: { repoPath: "/repo", taskId: "task-1" },
      },
      {
        command: "task_pull_request_detect",
        input: { repoPath: "/repo", taskId: "task-1" },
      },
      {
        command: "task_pull_request_unlink",
        input: { repoPath: "/repo", taskId: "task-1" },
      },
      {
        command: "task_pull_request_upsert",
        input: { repoPath: "/repo", taskId: "task-1", content: { title: "PR", body: "Body" } },
      },
      {
        command: "task_direct_merge",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          input: {
            mergeMethod: "merge_commit",
            expected: {
              taskStatus: "human_review",
              sourceBranch: "odt/task-1",
              targetBranch: { branch: "main" },
            },
          },
        },
      },
      {
        command: "task_direct_merge_complete",
        input: { repoPath: "/repo", taskId: "task-1" },
      },
      {
        command: "task_pull_request_link_merged",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          pullRequest: {
            providerId: "github",
            number: 12,
            url: "https://github.com/acme/repo/pull/12",
            state: "merged",
            createdAt: "2026-05-10T10:00:00.000Z",
            updatedAt: "2026-05-10T11:00:00.000Z",
          },
        },
      },
      {
        command: "task_transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "in_progress" },
      },
      {
        command: "task_apply_event",
        input: { repoPath: "/repo", taskId: "task-1", eventId: "defer" },
      },
      {
        command: "build_blocked",
        input: { repoPath: "/repo", taskId: "task-1", reason: "Blocked" },
      },
      {
        command: "build_start",
        input: { repoPath: "/repo", taskId: "task-1", runtimeKind: "opencode" },
      },
      {
        command: "build_resumed",
        input: { repoPath: "/repo", taskId: "task-1" },
      },
      {
        command: "build_completed",
        input: { repoPath: "/repo", taskId: "task-1", summary: "Done" },
      },
      {
        command: "task_update",
        input: { repoPath: "/repo", taskId: "task-1", patch: { title: "Task" } },
      },
      {
        command: "repo_pull_request_sync",
        input: { repoPath: "/repo", expectedWorkspaceId: "repo-id" },
      },
      {
        command: "human_request_changes",
        input: { repoPath: "/repo", taskId: "task-1", note: "Please adjust" },
      },
      {
        command: "human_approve",
        input: { repoPath: "/repo", taskId: "task-1" },
      },
      {
        command: "workflow_artifact_save",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          code: "qaReport",
          markdown: "Looks good",
          submit: true,
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          verdict: "approved",
        },
      },
      {
        command: "workflow_artifact_save",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          code: "spec",
          markdown: "# Spec",
          submit: false,
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
        },
      },
      {
        command: "workflow_artifact_get",
        input: { repoPath: "/repo", taskId: "task-1", code: "plan" },
      },
    ]);
  });
});

test("passes reviewed publication consent through the completion command boundary", async () => {
  const intent = {
    repoPath: "/repo",
    taskId: "task-1",
    publicationConsent: {
      expectedMerge: {
        method: "merge_commit" as const,
        sourceBranch: "odt/task-1",
        targetBranch: { remote: "origin", branch: "main" },
        mergedAt: "2026-10-13T12:00:00Z",
      },
      expectedPublication: {
        sourceOid: "a".repeat(40),
        remote: "origin",
        targetRef: "refs/heads/main",
        destinations: [{ identity: "bound", label: "/reviewed.git" }],
      },
    },
  };
  const calls: unknown[] = [];
  const handlers = createTaskCommandHandlers(
    createTaskCommandService({
      completeDirectMerge: (input) =>
        Effect.sync(() => {
          calls.push(input);
          return taskFixture;
        }),
    }),
  );
  await Effect.runPromise(handlers.task_direct_merge_complete(intent));
  expect(calls).toEqual([intent]);
});
