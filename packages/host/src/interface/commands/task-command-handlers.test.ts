import { Effect } from "effect";
import type { TaskService, TaskServiceError } from "../../application/tasks/task-service";
import { HostOperationError } from "../../effect/host-errors";
import { createTaskCommandHandlers } from "./task-command-handlers";

const runHandler = <T>(effect: unknown): Promise<T> => {
  if (!effect) {
    throw new Error("Expected task command handler to be registered");
  }
  return Effect.runPromise(effect as Effect.Effect<T, TaskServiceError>);
};

describe("createTaskCommandHandlers", () => {
  test("registers tasks_list", async () => {
    const calls: unknown[] = [];
    const service: Partial<TaskService> = {
      agentSessionDelete(input: unknown) {
        return Effect.sync(() => {
          calls.push({ command: "agent_session_delete", input });
          return true;
        });
      },
      agentSessionUpsert(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "agent_session_upsert", input });
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
      agentSessionsList(input: unknown) {
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
      agentSessionsListForTasks(input: unknown) {
        return Effect.sync(() => {
          calls.push({ command: "agent_sessions_list_for_tasks", input });
          return [];
        });
      },
      getApprovalContext(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_approval_context_get", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      detectPullRequest(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_pull_request_detect", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      unlinkPullRequest(input: unknown) {
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
      upsertPullRequest(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_pull_request_upsert", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      directMerge(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_direct_merge", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      completeDirectMerge(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_direct_merge_complete", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      linkMergedPullRequest(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_pull_request_link_merged", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      buildBlocked(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "build_blocked", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      buildStart(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "build_start", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      buildCompleted(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "build_completed", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      buildResumed(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "build_resumed", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      createTask(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_create", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask(input: unknown) {
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
      closeTask(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_close", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      resetImplementation(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_reset_implementation", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      resetTask(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_reset", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      listTasks(input: unknown) {
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
      getTaskMetadata(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_metadata_get", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      humanApprove(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "human_approve", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      humanRequestChanges(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "human_request_changes", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      savePlanDocument(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "plan_save_document", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      planGet(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "plan_get", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      saveSpecDocument(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "spec_save_document", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      specGet(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "spec_get", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPlan(input: unknown) {
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
      setSpec(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "set_spec", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      qaApproved(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "qa_approved", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      qaGetReport(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "qa_get_report", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      qaRejected(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "qa_rejected", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      repoPullRequestSync(input: unknown) {
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
      repoPullRequestSyncDetailed(input: unknown) {
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
      transitionTask(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_transition", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateTask(input: unknown) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ command: "task_update", input });
            return {} as never;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    } as unknown as TaskService;
    const handlers = createTaskCommandHandlers(service as TaskService);
    await expect(
      runHandler(
        handlers.tasks_list?.(
          { repoPath: "/repo" },
          {
            command: "tasks_list",
            args: { repoPath: "/repo" },
          },
        ),
      ),
    ).resolves.toEqual([]);
    await expect(
      runHandler(
        handlers.task_create?.(
          {
            repoPath: "/repo",
            input: { title: "Task", issueType: "task", priority: 2, aiReviewEnabled: true },
          },
          {
            command: "task_create",
            args: {
              repoPath: "/repo",
              input: { title: "Task", issueType: "task", priority: 2, aiReviewEnabled: true },
            },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.task_delete?.(
          { repoPath: "/repo", taskId: "task-1", deleteSubtasks: true },
          {
            command: "task_delete",
            args: { repoPath: "/repo", taskId: "task-1", deleteSubtasks: true },
          },
        ),
      ),
    ).resolves.toEqual({ ok: true });
    await expect(
      runHandler(
        handlers.task_close?.(
          { repoPath: "/repo", taskId: "task-1" },
          {
            command: "task_close",
            args: { repoPath: "/repo", taskId: "task-1" },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.task_reset_implementation?.(
          { repoPath: "/repo", taskId: "task-1" },
          {
            command: "task_reset_implementation",
            args: { repoPath: "/repo", taskId: "task-1" },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.task_reset?.(
          { repoPath: "/repo", taskId: "task-1" },
          {
            command: "task_reset",
            args: { repoPath: "/repo", taskId: "task-1" },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.task_metadata_get?.(
          { repoPath: "/repo", taskId: "task-1" },
          {
            command: "task_metadata_get",
            args: { repoPath: "/repo", taskId: "task-1" },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.agent_session_upsert?.(
          {
            repoPath: "/repo",
            taskId: "task-1",
            session: {
              externalSessionId: "session-1",
              role: "build",
              startedAt: "2026-05-10T10:00:00.000Z",
              runtimeKind: "opencode",
              workingDirectory: "/repo/task-1",
              selectedModel: null,
            },
          },
          {
            command: "agent_session_upsert",
            args: {
              repoPath: "/repo",
              taskId: "task-1",
              session: {
                externalSessionId: "session-1",
                role: "build",
                startedAt: "2026-05-10T10:00:00.000Z",
                runtimeKind: "opencode",
                workingDirectory: "/repo/task-1",
                selectedModel: null,
              },
            },
          },
        ),
      ),
    ).resolves.toBe(true);
    await expect(
      runHandler(
        handlers.agent_session_delete?.(
          {
            repoPath: "/repo",
            taskId: "task-1",
            identity: {
              externalSessionId: "session-1",
              runtimeKind: "opencode",
              workingDirectory: "/repo/task-1",
            },
          },
          {
            command: "agent_session_delete",
            args: {
              repoPath: "/repo",
              taskId: "task-1",
              identity: {
                externalSessionId: "session-1",
                runtimeKind: "opencode",
                workingDirectory: "/repo/task-1",
              },
            },
          },
        ),
      ),
    ).resolves.toBe(true);
    await expect(
      runHandler(
        handlers.agent_sessions_list?.(
          { repoPath: "/repo", taskId: "task-1" },
          {
            command: "agent_sessions_list",
            args: { repoPath: "/repo", taskId: "task-1" },
          },
        ),
      ),
    ).resolves.toEqual([]);
    await expect(
      runHandler(
        handlers.agent_sessions_list_for_tasks?.(
          { repoPath: "/repo", taskIds: ["task-2", "task-1", "task-2"] },
          {
            command: "agent_sessions_list_for_tasks",
            args: { repoPath: "/repo", taskIds: ["task-2", "task-1", "task-2"] },
          },
        ),
      ),
    ).resolves.toEqual([]);
    await expect(
      runHandler(
        handlers.task_approval_context_get?.(
          { repoPath: "/repo", taskId: "task-1" },
          {
            command: "task_approval_context_get",
            args: { repoPath: "/repo", taskId: "task-1" },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.task_pull_request_detect?.(
          { repoPath: "/repo", taskId: "task-1" },
          {
            command: "task_pull_request_detect",
            args: { repoPath: "/repo", taskId: "task-1" },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.task_pull_request_unlink?.(
          { repoPath: "/repo", taskId: "task-1" },
          {
            command: "task_pull_request_unlink",
            args: { repoPath: "/repo", taskId: "task-1" },
          },
        ),
      ),
    ).resolves.toBe(true);
    await expect(
      runHandler(
        handlers.task_pull_request_upsert?.(
          { repoPath: "/repo", taskId: "task-1", input: { title: "PR", body: "Body" } },
          {
            command: "task_pull_request_upsert",
            args: { repoPath: "/repo", taskId: "task-1", input: { title: "PR", body: "Body" } },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.task_direct_merge?.(
          { repoPath: "/repo", taskId: "task-1", input: { mergeMethod: "merge_commit" } },
          {
            command: "task_direct_merge",
            args: { repoPath: "/repo", taskId: "task-1", input: { mergeMethod: "merge_commit" } },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.task_direct_merge_complete?.(
          { repoPath: "/repo", taskId: "task-1" },
          {
            command: "task_direct_merge_complete",
            args: { repoPath: "/repo", taskId: "task-1" },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.task_pull_request_link_merged?.(
          {
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
          {
            command: "task_pull_request_link_merged",
            args: {
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
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.task_transition?.(
          { repoPath: "/repo", taskId: "task-1", status: "in_progress" },
          {
            command: "task_transition",
            args: { repoPath: "/repo", taskId: "task-1", status: "in_progress" },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.build_blocked?.(
          { repoPath: "/repo", taskId: "task-1", reason: "Blocked" },
          {
            command: "build_blocked",
            args: { repoPath: "/repo", taskId: "task-1", reason: "Blocked" },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.build_start?.(
          { repoPath: "/repo", taskId: "task-1", runtimeKind: "opencode" },
          {
            command: "build_start",
            args: { repoPath: "/repo", taskId: "task-1", runtimeKind: "opencode" },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.build_resumed?.(
          { repoPath: "/repo", taskId: "task-1" },
          {
            command: "build_resumed",
            args: { repoPath: "/repo", taskId: "task-1" },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.build_completed?.(
          { repoPath: "/repo", taskId: "task-1", input: { summary: "Done" } },
          {
            command: "build_completed",
            args: { repoPath: "/repo", taskId: "task-1", input: { summary: "Done" } },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.task_update?.(
          { repoPath: "/repo", taskId: "task-1", patch: { title: "Task" } },
          {
            command: "task_update",
            args: { repoPath: "/repo", taskId: "task-1", patch: { title: "Task" } },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.qa_approved?.(
          { repoPath: "/repo", taskId: "task-1", reportMarkdown: "Looks good" },
          {
            command: "qa_approved",
            args: { repoPath: "/repo", taskId: "task-1", reportMarkdown: "Looks good" },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.qa_rejected?.(
          { repoPath: "/repo", taskId: "task-1", reportMarkdown: "Needs work" },
          {
            command: "qa_rejected",
            args: { repoPath: "/repo", taskId: "task-1", reportMarkdown: "Needs work" },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.qa_get_report?.(
          { repoPath: "/repo", taskId: "task-1" },
          {
            command: "qa_get_report",
            args: { repoPath: "/repo", taskId: "task-1" },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.repo_pull_request_sync?.(
          { repoPath: "/repo" },
          {
            command: "repo_pull_request_sync",
            args: { repoPath: "/repo" },
          },
        ),
      ),
    ).resolves.toEqual({ ok: true });
    await expect(
      runHandler(
        handlers.human_request_changes?.(
          { repoPath: "/repo", taskId: "task-1", note: "Please adjust" },
          {
            command: "human_request_changes",
            args: { repoPath: "/repo", taskId: "task-1", note: "Please adjust" },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.human_approve?.(
          { repoPath: "/repo", taskId: "task-1" },
          {
            command: "human_approve",
            args: { repoPath: "/repo", taskId: "task-1" },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.set_spec?.(
          { repoPath: "/repo", taskId: "task-1", markdown: "# Spec" },
          {
            command: "set_spec",
            args: { repoPath: "/repo", taskId: "task-1", markdown: "# Spec" },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.spec_save_document?.(
          { repoPath: "/repo", taskId: "task-1", markdown: "# Spec" },
          {
            command: "spec_save_document",
            args: { repoPath: "/repo", taskId: "task-1", markdown: "# Spec" },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.spec_get?.(
          { repoPath: "/repo", taskId: "task-1" },
          {
            command: "spec_get",
            args: { repoPath: "/repo", taskId: "task-1" },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.set_plan?.(
          { repoPath: "/repo", taskId: "task-1", input: { markdown: "# Plan" } },
          {
            command: "set_plan",
            args: { repoPath: "/repo", taskId: "task-1", input: { markdown: "# Plan" } },
          },
        ),
      ),
    ).resolves.toEqual({ markdown: "# Plan" });
    await expect(
      runHandler(
        handlers.plan_save_document?.(
          { repoPath: "/repo", taskId: "task-1", markdown: "# Plan" },
          {
            command: "plan_save_document",
            args: { repoPath: "/repo", taskId: "task-1", markdown: "# Plan" },
          },
        ),
      ),
    ).resolves.toEqual({});
    await expect(
      runHandler(
        handlers.plan_get?.(
          { repoPath: "/repo", taskId: "task-1" },
          {
            command: "plan_get",
            args: { repoPath: "/repo", taskId: "task-1" },
          },
        ),
      ),
    ).resolves.toEqual({});
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
        command: "agent_session_upsert",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          session: {
            externalSessionId: "session-1",
            role: "build",
            startedAt: "2026-05-10T10:00:00.000Z",
            runtimeKind: "opencode",
            workingDirectory: "/repo/task-1",
            selectedModel: null,
          },
        },
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
