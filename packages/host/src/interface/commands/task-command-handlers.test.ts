import { Effect } from "effect";
import type {
  BuildSessionBootstrap,
  PullRequest,
  TaskApprovalContextLoadResult,
  TaskCard,
  TaskDirectMergeResult,
  TaskMetadataDocument,
  TaskMetadataPayload,
  TaskPullRequestDetectResult,
} from "@openducktor/contracts";
import { createTaskServiceTestDouble } from "../../test-support/task-service-test-double";
import { HostOperationError } from "../../effect/host-errors";
import { createTaskCommandHandlers } from "./task-command-handlers";
import type { HostCommandHandlerError } from "../router/host-command-router";

const taskFixture: TaskCard = {
  id: "task-1",
  title: "Task",
  description: "",
  status: "open",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  parentId: undefined,
  subtaskIds: [],
  pullRequest: undefined,
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    builder: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-05-10T10:00:00.000Z",
  createdAt: "2026-05-10T10:00:00.000Z",
};

const documentFixture: TaskMetadataDocument = { markdown: "# Fixture" };
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
  spec: documentFixture,
  plan: documentFixture,
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
  test("registers tasks_list", async () => {
    const calls: unknown[] = [];
    const service = createTaskServiceTestDouble({
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
      listTasks(input) {
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
      savePlanDocument(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "plan_save_document", input });
            return documentFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      planGet(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "plan_get", input });
            return documentFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      saveSpecDocument(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "spec_save_document", input });
            return documentFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      specGet(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "spec_get", input });
            return documentFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPlan(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "set_plan", input });
            return {
              document: { markdown: "# Plan" },
              changes: { taskIds: ["task-1"], removedTaskIds: [] },
            };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setSpec(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "set_spec", input });
            return documentFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      qaApproved(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "qa_approved", input });
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
      qaGetReport(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "qa_get_report", input });
            return documentFixture;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      qaRejected(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "qa_rejected", input });
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
      repoPullRequestSync(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "repo_pull_request_sync", input });
            return { ok: true };
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
            return { ran: true, changedTaskIds: [] };
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
          input: { title: "Task", issueType: "task", priority: 2, aiReviewEnabled: true },
        }),
      ),
    ).resolves.toBeDefined();
    await expect(
      runHandler(
        handlers.task_delete?.({ repoPath: "/repo", taskId: "task-1", deleteSubtasks: true }),
      ),
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
          input: { mergeMethod: "merge_commit" },
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
        handlers.qa_approved?.({
          repoPath: "/repo",
          taskId: "task-1",
          reportMarkdown: "Looks good",
        }),
      ),
    ).resolves.toBeDefined();
    await expect(
      runHandler(
        handlers.qa_rejected?.({
          repoPath: "/repo",
          taskId: "task-1",
          reportMarkdown: "Needs work",
        }),
      ),
    ).resolves.toBeDefined();
    await expect(
      runHandler(handlers.qa_get_report?.({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toBeDefined();
    await expect(
      runHandler(handlers.repo_pull_request_sync?.({ repoPath: "/repo" })),
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
      runHandler(handlers.set_spec?.({ repoPath: "/repo", taskId: "task-1", markdown: "# Spec" })),
    ).resolves.toBeDefined();
    await expect(
      runHandler(
        handlers.spec_save_document?.({ repoPath: "/repo", taskId: "task-1", markdown: "# Spec" }),
      ),
    ).resolves.toBeDefined();
    await expect(
      runHandler(handlers.spec_get?.({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toBeDefined();
    await expect(
      runHandler(
        handlers.set_plan?.({ repoPath: "/repo", taskId: "task-1", input: { markdown: "# Plan" } }),
      ),
    ).resolves.toEqual({ markdown: "# Plan" });
    await expect(
      runHandler(
        handlers.plan_save_document?.({ repoPath: "/repo", taskId: "task-1", markdown: "# Plan" }),
      ),
    ).resolves.toBeDefined();
    await expect(
      runHandler(handlers.plan_get?.({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toBeDefined();
    expect(calls).toEqual([
      { command: "tasks_list", input: { repoPath: "/repo" } },
      {
        command: "task_create",
        input: {
          repoPath: "/repo",
          task: { title: "Task", issueType: "task", priority: 2, aiReviewEnabled: true },
        },
      },
      {
        command: "task_delete",
        input: { repoPath: "/repo", taskId: "task-1", deleteSubtasks: true },
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
        input: { repoPath: "/repo", taskId: "task-1", input: { mergeMethod: "merge_commit" } },
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
        command: "qa_approved",
        input: { repoPath: "/repo", taskId: "task-1", markdown: "Looks good" },
      },
      {
        command: "qa_rejected",
        input: { repoPath: "/repo", taskId: "task-1", markdown: "Needs work" },
      },
      {
        command: "qa_get_report",
        input: { repoPath: "/repo", taskId: "task-1" },
      },
      {
        command: "repo_pull_request_sync",
        input: { repoPath: "/repo" },
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
        command: "set_spec",
        input: { repoPath: "/repo", taskId: "task-1", markdown: "# Spec" },
      },
      {
        command: "spec_save_document",
        input: { repoPath: "/repo", taskId: "task-1", markdown: "# Spec" },
      },
      {
        command: "spec_get",
        input: { repoPath: "/repo", taskId: "task-1" },
      },
      {
        command: "set_plan",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          markdown: "# Plan",
          subtasks: [],
          hasExplicitSubtasks: false,
        },
      },
      {
        command: "plan_save_document",
        input: { repoPath: "/repo", taskId: "task-1", markdown: "# Plan" },
      },
      {
        command: "plan_get",
        input: { repoPath: "/repo", taskId: "task-1" },
      },
    ]);
  });
});
