import { createTaskCommandHandlers } from "./task-command-handlers";
import type { TaskService } from "./task-service";

describe("createTaskCommandHandlers", () => {
  test("registers tasks_list", async () => {
    const calls: unknown[] = [];
    const service: TaskService = {
      async agentSessionUpsert(input) {
        calls.push({ command: "agent_session_upsert", input });
        return true;
      },
      async agentSessionsList(input) {
        calls.push({ command: "agent_sessions_list", input });
        return [];
      },
      async agentSessionsListBulk(input) {
        calls.push({ command: "agent_sessions_list_bulk", input });
        return {};
      },
      async getApprovalContext(input) {
        calls.push({ command: "task_approval_context_get", input });
        return {} as never;
      },
      async detectPullRequest(input) {
        calls.push({ command: "task_pull_request_detect", input });
        return {} as never;
      },
      async unlinkPullRequest(input) {
        calls.push({ command: "task_pull_request_unlink", input });
        return true;
      },
      async upsertPullRequest(input) {
        calls.push({ command: "task_pull_request_upsert", input });
        return {} as never;
      },
      async directMerge(input) {
        calls.push({ command: "task_direct_merge", input });
        return {} as never;
      },
      async completeDirectMerge(input) {
        calls.push({ command: "task_direct_merge_complete", input });
        return {} as never;
      },
      async linkMergedPullRequest(input) {
        calls.push({ command: "task_pull_request_link_merged", input });
        return {} as never;
      },
      async buildBlocked(input) {
        calls.push({ command: "build_blocked", input });
        return {} as never;
      },
      async buildStart(input) {
        calls.push({ command: "build_start", input });
        return {} as never;
      },
      async buildCompleted(input) {
        calls.push({ command: "build_completed", input });
        return {} as never;
      },
      async buildResumed(input) {
        calls.push({ command: "build_resumed", input });
        return {} as never;
      },
      async createTask(input) {
        calls.push({ command: "task_create", input });
        return {} as never;
      },
      async deleteTask(input) {
        calls.push({ command: "task_delete", input });
        return { ok: true };
      },
      async resetImplementation(input) {
        calls.push({ command: "task_reset_implementation", input });
        return {} as never;
      },
      async resetTask(input) {
        calls.push({ command: "task_reset", input });
        return {} as never;
      },
      async deferTask(input) {
        calls.push({ command: "task_defer", input });
        return {} as never;
      },
      async listTasks(input) {
        calls.push({ command: "tasks_list", input });
        return [];
      },
      async getTaskMetadata(input) {
        calls.push({ command: "task_metadata_get", input });
        return {} as never;
      },
      async humanApprove(input) {
        calls.push({ command: "human_approve", input });
        return {} as never;
      },
      async humanRequestChanges(input) {
        calls.push({ command: "human_request_changes", input });
        return {} as never;
      },
      async savePlanDocument(input) {
        calls.push({ command: "plan_save_document", input });
        return {} as never;
      },
      async planGet(input) {
        calls.push({ command: "plan_get", input });
        return {} as never;
      },
      async saveSpecDocument(input) {
        calls.push({ command: "spec_save_document", input });
        return {} as never;
      },
      async specGet(input) {
        calls.push({ command: "spec_get", input });
        return {} as never;
      },
      async setPlan(input) {
        calls.push({ command: "set_plan", input });
        return {} as never;
      },
      async setSpec(input) {
        calls.push({ command: "set_spec", input });
        return {} as never;
      },
      async qaApproved(input) {
        calls.push({ command: "qa_approved", input });
        return {} as never;
      },
      async qaGetReport(input) {
        calls.push({ command: "qa_get_report", input });
        return {} as never;
      },
      async qaRejected(input) {
        calls.push({ command: "qa_rejected", input });
        return {} as never;
      },
      async repoPullRequestSync(input) {
        calls.push({ command: "repo_pull_request_sync", input });
        return { ok: true };
      },
      async repoPullRequestSyncDetailed(input) {
        calls.push({ command: "repo_pull_request_sync_detailed", input });
        return { ran: true, changedTaskIds: [] };
      },
      async resumeDeferredTask(input) {
        calls.push({ command: "task_resume_deferred", input });
        return {} as never;
      },
      async transitionTask(input) {
        calls.push({ command: "task_transition", input });
        return {} as never;
      },
      async updateTask(input) {
        calls.push({ command: "task_update", input });
        return {} as never;
      },
    };

    const handlers = createTaskCommandHandlers(service);

    await expect(
      handlers.tasks_list?.(
        { repoPath: "/repo" },
        {
          command: "tasks_list",
          args: { repoPath: "/repo" },
        },
      ),
    ).resolves.toEqual([]);
    await expect(
      handlers.task_create?.(
        { repoPath: "/repo", input: { title: "Task" } },
        {
          command: "task_create",
          args: { repoPath: "/repo", input: { title: "Task" } },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.task_delete?.(
        { repoPath: "/repo", taskId: "task-1", deleteSubtasks: true },
        {
          command: "task_delete",
          args: { repoPath: "/repo", taskId: "task-1", deleteSubtasks: true },
        },
      ),
    ).resolves.toEqual({ ok: true });
    await expect(
      handlers.task_reset_implementation?.(
        { repoPath: "/repo", taskId: "task-1" },
        {
          command: "task_reset_implementation",
          args: { repoPath: "/repo", taskId: "task-1" },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.task_reset?.(
        { repoPath: "/repo", taskId: "task-1" },
        {
          command: "task_reset",
          args: { repoPath: "/repo", taskId: "task-1" },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.task_metadata_get?.(
        { repoPath: "/repo", taskId: "task-1" },
        {
          command: "task_metadata_get",
          args: { repoPath: "/repo", taskId: "task-1" },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.agent_session_upsert?.(
        { repoPath: "/repo", taskId: "task-1", session: { externalSessionId: "session-1" } },
        {
          command: "agent_session_upsert",
          args: {
            repoPath: "/repo",
            taskId: "task-1",
            session: { externalSessionId: "session-1" },
          },
        },
      ),
    ).resolves.toBe(true);
    await expect(
      handlers.agent_sessions_list_bulk?.(
        { repoPath: "/repo", taskIds: ["task-1"] },
        {
          command: "agent_sessions_list_bulk",
          args: { repoPath: "/repo", taskIds: ["task-1"] },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.agent_sessions_list?.(
        { repoPath: "/repo", taskId: "task-1" },
        {
          command: "agent_sessions_list",
          args: { repoPath: "/repo", taskId: "task-1" },
        },
      ),
    ).resolves.toEqual([]);
    await expect(
      handlers.task_approval_context_get?.(
        { repoPath: "/repo", taskId: "task-1" },
        {
          command: "task_approval_context_get",
          args: { repoPath: "/repo", taskId: "task-1" },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.task_pull_request_detect?.(
        { repoPath: "/repo", taskId: "task-1" },
        {
          command: "task_pull_request_detect",
          args: { repoPath: "/repo", taskId: "task-1" },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.task_pull_request_unlink?.(
        { repoPath: "/repo", taskId: "task-1" },
        {
          command: "task_pull_request_unlink",
          args: { repoPath: "/repo", taskId: "task-1" },
        },
      ),
    ).resolves.toBe(true);
    await expect(
      handlers.task_pull_request_upsert?.(
        { repoPath: "/repo", taskId: "task-1", input: { title: "PR", body: "Body" } },
        {
          command: "task_pull_request_upsert",
          args: { repoPath: "/repo", taskId: "task-1", input: { title: "PR", body: "Body" } },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.task_direct_merge?.(
        { repoPath: "/repo", taskId: "task-1", input: { mergeMethod: "merge_commit" } },
        {
          command: "task_direct_merge",
          args: { repoPath: "/repo", taskId: "task-1", input: { mergeMethod: "merge_commit" } },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.task_direct_merge_complete?.(
        { repoPath: "/repo", taskId: "task-1" },
        {
          command: "task_direct_merge_complete",
          args: { repoPath: "/repo", taskId: "task-1" },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.task_pull_request_link_merged?.(
        { repoPath: "/repo", taskId: "task-1", pullRequest: { number: 12 } },
        {
          command: "task_pull_request_link_merged",
          args: { repoPath: "/repo", taskId: "task-1", pullRequest: { number: 12 } },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.task_transition?.(
        { repoPath: "/repo", taskId: "task-1", status: "in_progress" },
        {
          command: "task_transition",
          args: { repoPath: "/repo", taskId: "task-1", status: "in_progress" },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.task_defer?.(
        { repoPath: "/repo", taskId: "task-1", reason: "Later" },
        {
          command: "task_defer",
          args: { repoPath: "/repo", taskId: "task-1", reason: "Later" },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.task_resume_deferred?.(
        { repoPath: "/repo", taskId: "task-1" },
        {
          command: "task_resume_deferred",
          args: { repoPath: "/repo", taskId: "task-1" },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.build_blocked?.(
        { repoPath: "/repo", taskId: "task-1", reason: "Blocked" },
        {
          command: "build_blocked",
          args: { repoPath: "/repo", taskId: "task-1", reason: "Blocked" },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.build_start?.(
        { repoPath: "/repo", taskId: "task-1", runtimeKind: "opencode" },
        {
          command: "build_start",
          args: { repoPath: "/repo", taskId: "task-1", runtimeKind: "opencode" },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.build_resumed?.(
        { repoPath: "/repo", taskId: "task-1" },
        {
          command: "build_resumed",
          args: { repoPath: "/repo", taskId: "task-1" },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.build_completed?.(
        { repoPath: "/repo", taskId: "task-1", input: { summary: "Done" } },
        {
          command: "build_completed",
          args: { repoPath: "/repo", taskId: "task-1", input: { summary: "Done" } },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.task_update?.(
        { repoPath: "/repo", taskId: "task-1", patch: { title: "Task" } },
        {
          command: "task_update",
          args: { repoPath: "/repo", taskId: "task-1", patch: { title: "Task" } },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.qa_approved?.(
        { repoPath: "/repo", taskId: "task-1", reportMarkdown: "Looks good" },
        {
          command: "qa_approved",
          args: { repoPath: "/repo", taskId: "task-1", reportMarkdown: "Looks good" },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.qa_rejected?.(
        { repoPath: "/repo", taskId: "task-1", reportMarkdown: "Needs work" },
        {
          command: "qa_rejected",
          args: { repoPath: "/repo", taskId: "task-1", reportMarkdown: "Needs work" },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.qa_get_report?.(
        { repoPath: "/repo", taskId: "task-1" },
        {
          command: "qa_get_report",
          args: { repoPath: "/repo", taskId: "task-1" },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.repo_pull_request_sync?.(
        { repoPath: "/repo" },
        {
          command: "repo_pull_request_sync",
          args: { repoPath: "/repo" },
        },
      ),
    ).resolves.toEqual({ ok: true });
    await expect(
      handlers.human_request_changes?.(
        { repoPath: "/repo", taskId: "task-1", note: "Please adjust" },
        {
          command: "human_request_changes",
          args: { repoPath: "/repo", taskId: "task-1", note: "Please adjust" },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.human_approve?.(
        { repoPath: "/repo", taskId: "task-1" },
        {
          command: "human_approve",
          args: { repoPath: "/repo", taskId: "task-1" },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.set_spec?.(
        { repoPath: "/repo", taskId: "task-1", markdown: "# Spec" },
        {
          command: "set_spec",
          args: { repoPath: "/repo", taskId: "task-1", markdown: "# Spec" },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.spec_save_document?.(
        { repoPath: "/repo", taskId: "task-1", markdown: "# Spec" },
        {
          command: "spec_save_document",
          args: { repoPath: "/repo", taskId: "task-1", markdown: "# Spec" },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.spec_get?.(
        { repoPath: "/repo", taskId: "task-1" },
        {
          command: "spec_get",
          args: { repoPath: "/repo", taskId: "task-1" },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.set_plan?.(
        { repoPath: "/repo", taskId: "task-1", input: { markdown: "# Plan" } },
        {
          command: "set_plan",
          args: { repoPath: "/repo", taskId: "task-1", input: { markdown: "# Plan" } },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.plan_save_document?.(
        { repoPath: "/repo", taskId: "task-1", markdown: "# Plan" },
        {
          command: "plan_save_document",
          args: { repoPath: "/repo", taskId: "task-1", markdown: "# Plan" },
        },
      ),
    ).resolves.toEqual({});
    await expect(
      handlers.plan_get?.(
        { repoPath: "/repo", taskId: "task-1" },
        {
          command: "plan_get",
          args: { repoPath: "/repo", taskId: "task-1" },
        },
      ),
    ).resolves.toEqual({});
    expect(calls).toEqual([
      { command: "tasks_list", input: { repoPath: "/repo" } },
      { command: "task_create", input: { repoPath: "/repo", input: { title: "Task" } } },
      {
        command: "task_delete",
        input: { repoPath: "/repo", taskId: "task-1", deleteSubtasks: true },
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
        input: { repoPath: "/repo", taskId: "task-1", session: { externalSessionId: "session-1" } },
      },
      {
        command: "agent_sessions_list_bulk",
        input: { repoPath: "/repo", taskIds: ["task-1"] },
      },
      {
        command: "agent_sessions_list",
        input: { repoPath: "/repo", taskId: "task-1" },
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
        input: { repoPath: "/repo", taskId: "task-1", input: { title: "PR", body: "Body" } },
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
        input: { repoPath: "/repo", taskId: "task-1", pullRequest: { number: 12 } },
      },
      {
        command: "task_transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "in_progress" },
      },
      {
        command: "task_defer",
        input: { repoPath: "/repo", taskId: "task-1", reason: "Later" },
      },
      {
        command: "task_resume_deferred",
        input: { repoPath: "/repo", taskId: "task-1" },
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
        input: { repoPath: "/repo", taskId: "task-1", input: { summary: "Done" } },
      },
      {
        command: "task_update",
        input: { repoPath: "/repo", taskId: "task-1", patch: { title: "Task" } },
      },
      {
        command: "qa_approved",
        input: { repoPath: "/repo", taskId: "task-1", reportMarkdown: "Looks good" },
      },
      {
        command: "qa_rejected",
        input: { repoPath: "/repo", taskId: "task-1", reportMarkdown: "Needs work" },
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
        input: { repoPath: "/repo", taskId: "task-1", input: { markdown: "# Plan" } },
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
