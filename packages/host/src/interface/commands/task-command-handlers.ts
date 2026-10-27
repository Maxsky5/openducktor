import {
  artifactReadRequestSchema,
  artifactCreateRequestSchema,
  artifactRenameRequestSchema,
  artifactReplaceRequestSchema,
  artifactDeleteRequestSchema,
} from "@openducktor/contracts";
import type { z } from "zod";
import { HostValidationError } from "../../effect/host-errors";
import { Effect } from "effect";
import type { TaskService } from "../../application/tasks/task-service";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import type { HostCommandArgs } from "./command-inputs";
import {
  parseAgentSessionDeleteInput,
  parseBuildBlockedInput,
  parseBuildCompletedInput,
  parseBuildStartInput,
  parseCloseTaskInput,
  parseCreateTaskInput,
  parseApplyTaskEventInput,
  parseDeleteTaskInput,
  parseDirectMergeInput,
  parseDirectMergeCompleteInput,
  parseListAgentSessionsForTasksInput,
  parseOptionalNoteInput,
  parsePullRequestLinkMergedInput,
  parsePullRequestUpsertInput,
  parseRepoPathInput,
  parseRepoPullRequestSyncInput,
  parseTaskIdInput,
  parseTaskStopImpactInput,
  parseTransitionTaskInput,
  parseUpdateTaskInput,
  parseWorkflowArtifactInput,
  parseWorkflowArtifactSaveInput,
} from "./task-command-inputs";

const parseArtifactCommand = <T>(schema: z.ZodType<T>, input: HostCommandArgs): T => {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new HostValidationError({
      field: "artifact",
      message: parsed.error.message,
      cause: parsed.error,
    });
  return parsed.data;
};

export const createTaskCommandHandlers = (taskService: TaskService) =>
  ({
    agent_session_delete: (args) =>
      taskService.agentSessionDelete(parseAgentSessionDeleteInput(args)),
    agent_sessions_list: (args) =>
      taskService.agentSessionsList(parseTaskIdInput(args, "agent_sessions_list input")),
    agent_sessions_list_for_tasks: (args) =>
      taskService.agentSessionsListForTasks(parseListAgentSessionsForTasksInput(args)),
    build_blocked: (args) => taskService.buildBlocked(parseBuildBlockedInput(args)),
    build_completed: (args) => taskService.buildCompleted(parseBuildCompletedInput(args)),
    build_resumed: (args) =>
      taskService.buildResumed(parseTaskIdInput(args, "build_resumed input")),
    build_start: (args) => taskService.buildStart(parseBuildStartInput(args)),
    human_request_changes: (args) =>
      taskService.humanRequestChanges(
        parseOptionalNoteInput(args, "human_request_changes input", "human_request_changes note"),
      ),
    repo_pull_request_sync: (args) =>
      taskService.repoPullRequestSync(parseRepoPullRequestSyncInput(args)),
    task_approval_context_get: (args) =>
      taskService.getApprovalContext(parseTaskIdInput(args, "task_approval_context_get input")),
    task_close: (args) => taskService.closeTask(parseCloseTaskInput(args)),
    task_pull_request_detect: (args) =>
      taskService.detectPullRequest(parseTaskIdInput(args, "task_pull_request_detect input")),
    task_direct_merge: (args) => taskService.directMerge(parseDirectMergeInput(args)),
    task_direct_merge_complete: (args) =>
      taskService.completeDirectMerge(parseDirectMergeCompleteInput(args)),
    task_pull_request_link_merged: (args) =>
      taskService.linkMergedPullRequest(parsePullRequestLinkMergedInput(args)),
    task_pull_request_unlink: (args) =>
      taskService.unlinkPullRequest(parseTaskIdInput(args, "task_pull_request_unlink input")),
    task_pull_request_upsert: (args) =>
      taskService.upsertPullRequest(parsePullRequestUpsertInput(args)),
    task_create: (args) => taskService.createTask(parseCreateTaskInput(args)),
    task_delete: (args) =>
      taskService.deleteTask(parseDeleteTaskInput(args)).pipe(Effect.map(({ ok }) => ({ ok }))),
    task_artifacts_list: (args) =>
      taskService.listTaskArtifacts(parseTaskIdInput(args, "task_artifacts_list input")),
    task_artifact_read: (args) =>
      taskService.readTaskArtifact(parseArtifactCommand(artifactReadRequestSchema, args)),
    task_artifact_create: (args) =>
      taskService.createTaskArtifact(parseArtifactCommand(artifactCreateRequestSchema, args)),
    task_artifact_rename: (args) =>
      taskService.renameTaskArtifact(parseArtifactCommand(artifactRenameRequestSchema, args)),
    task_artifact_replace: (args) =>
      taskService.replaceTaskArtifact(parseArtifactCommand(artifactReplaceRequestSchema, args)),
    task_artifact_delete: (args) =>
      taskService.deleteTaskArtifact(parseArtifactCommand(artifactDeleteRequestSchema, args)),
    task_metadata_get: (args) =>
      taskService.getTaskMetadata(parseTaskIdInput(args, "task_metadata_get input")),
    task_reset: (args) => taskService.resetTask(parseTaskIdInput(args, "task_reset input")),
    task_reset_implementation: (args) =>
      taskService.resetImplementation(parseTaskIdInput(args, "task_reset_implementation input")),
    task_stop_impact_get: (args) => taskService.getTaskStopImpact(parseTaskStopImpactInput(args)),
    task_worktree_cleanup_impact_get: (args) =>
      taskService.getTaskWorktreeCleanupImpact(
        parseTaskIdInput(args, "task_worktree_cleanup_impact_get input"),
      ),
    task_worktree_remove: (args) =>
      taskService.removeTaskWorktree(parseTaskIdInput(args, "task_worktree_remove input")),
    task_transition: (args) => taskService.transitionTask(parseTransitionTaskInput(args)),
    task_apply_event: (args) => taskService.applyTaskEvent(parseApplyTaskEventInput(args)),
    task_update: (args) => taskService.updateTask(parseUpdateTaskInput(args)),
    tasks_list: (args) => taskService.listKanbanTasks(parseRepoPathInput(args, "tasks_list input")),
    tasks_list_all: (args) =>
      taskService.listTasks(parseRepoPathInput(args, "tasks_list_all input")),
    task_ids_list: (args) =>
      taskService.listTaskIds(parseRepoPathInput(args, "task_ids_list input")),
    workflow_artifact_get: (args) =>
      taskService.workflowArtifactGet(parseWorkflowArtifactInput(args)),
    workflow_artifact_save: (args) =>
      taskService
        .workflowArtifactSave(parseWorkflowArtifactSaveInput(args))
        .pipe(Effect.map(({ artifact }) => artifact)),
  }) satisfies HostCommandHandlerDefinitions;
