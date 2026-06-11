import type { TaskService } from "../../application/tasks/task-service";
import type { HostCommandHandlers } from "../router/host-command-router";
import {
  parseAgentSessionsListBulkInput,
  parseAgentSessionUpsertInput,
  parseBuildBlockedInput,
  parseBuildCompletedInput,
  parseBuildStartInput,
  parseCreateTaskInput,
  parseDeleteTaskInput,
  parseDirectMergeInput,
  parseListTasksInput,
  parseMarkdownDocumentInput,
  parseOptionalNoteInput,
  parsePullRequestLinkMergedInput,
  parsePullRequestUpsertInput,
  parseQaOutcomeInput,
  parseRepoPathInput,
  parseSetPlanInput,
  parseTaskIdInput,
  parseTransitionTaskInput,
  parseUpdateTaskInput,
} from "./task-command-inputs";

export const createTaskCommandHandlers = (taskService: TaskService): HostCommandHandlers => ({
  agent_session_upsert: (args) =>
    taskService.agentSessionUpsert(parseAgentSessionUpsertInput(args)),
  agent_sessions_list: (args) =>
    taskService.agentSessionsList(parseTaskIdInput(args, "agent_sessions_list input")),
  agent_sessions_list_bulk: (args) =>
    taskService.agentSessionsListBulk(parseAgentSessionsListBulkInput(args)),
  build_blocked: (args) => taskService.buildBlocked(parseBuildBlockedInput(args)),
  build_completed: (args) => taskService.buildCompleted(parseBuildCompletedInput(args)),
  build_resumed: (args) => taskService.buildResumed(parseTaskIdInput(args, "build_resumed input")),
  build_start: (args) => taskService.buildStart(parseBuildStartInput(args)),
  human_approve: (args) => taskService.humanApprove(parseTaskIdInput(args, "human_approve input")),
  human_request_changes: (args) =>
    taskService.humanRequestChanges(
      parseOptionalNoteInput(args, "human_request_changes input", "human_request_changes note"),
    ),
  qa_approved: (args) => taskService.qaApproved(parseQaOutcomeInput(args, "qa_approved input")),
  qa_get_report: (args) => taskService.qaGetReport(parseTaskIdInput(args, "qa_get_report input")),
  qa_rejected: (args) => taskService.qaRejected(parseQaOutcomeInput(args, "qa_rejected input")),
  repo_pull_request_sync: (args) =>
    taskService.repoPullRequestSync(parseRepoPathInput(args, "repo_pull_request_sync input")),
  task_approval_context_get: (args) =>
    taskService.getApprovalContext(parseTaskIdInput(args, "task_approval_context_get input")),
  task_pull_request_detect: (args) =>
    taskService.detectPullRequest(parseTaskIdInput(args, "task_pull_request_detect input")),
  task_direct_merge: (args) => taskService.directMerge(parseDirectMergeInput(args)),
  task_direct_merge_complete: (args) =>
    taskService.completeDirectMerge(parseTaskIdInput(args, "task_direct_merge_complete input")),
  task_pull_request_link_merged: (args) =>
    taskService.linkMergedPullRequest(parsePullRequestLinkMergedInput(args)),
  task_pull_request_unlink: (args) =>
    taskService.unlinkPullRequest(parseTaskIdInput(args, "task_pull_request_unlink input")),
  task_pull_request_upsert: (args) =>
    taskService.upsertPullRequest(parsePullRequestUpsertInput(args)),
  task_create: (args) => taskService.createTask(parseCreateTaskInput(args)),
  task_delete: (args) => taskService.deleteTask(parseDeleteTaskInput(args)),
  task_metadata_get: (args) =>
    taskService.getTaskMetadata(parseTaskIdInput(args, "task_metadata_get input")),
  task_reset: (args) => taskService.resetTask(parseTaskIdInput(args, "task_reset input")),
  task_reset_implementation: (args) =>
    taskService.resetImplementation(parseTaskIdInput(args, "task_reset_implementation input")),
  task_transition: (args) => taskService.transitionTask(parseTransitionTaskInput(args)),
  task_update: (args) => taskService.updateTask(parseUpdateTaskInput(args)),
  set_plan: (args) => taskService.setPlan(parseSetPlanInput(args)),
  set_spec: (args) =>
    taskService.setSpec(parseMarkdownDocumentInput(args, "set_spec input", "spec")),
  plan_get: (args) => taskService.planGet(parseTaskIdInput(args, "plan_get input")),
  plan_save_document: (args) =>
    taskService.savePlanDocument(
      parseMarkdownDocumentInput(args, "plan_save_document input", "implementation plan"),
    ),
  spec_get: (args) => taskService.specGet(parseTaskIdInput(args, "spec_get input")),
  spec_save_document: (args) =>
    taskService.saveSpecDocument(
      parseMarkdownDocumentInput(args, "spec_save_document input", "spec"),
    ),
  tasks_list: (args) => taskService.listTasks(parseListTasksInput(args)),
});
