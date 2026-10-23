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
import type {
  TaskService,
  TaskServiceWithMutationProgress,
} from "../../application/tasks/task-service";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import type { HostCommandArgs } from "./command-inputs";
import {
  parseAgentSessionDeleteInput,
  parseBuildBlockedInput,
  parseBuildCompletedInput,
  parseBuildStartInput,
  parseCreateTaskInput,
  parseDeleteTaskInput,
  parseDirectMergeInput,
  parseDirectMergeCompleteInput,
  parseListAgentSessionsForTasksInput,
  parseMarkdownArtifactInput,
  parseOptionalNoteInput,
  parsePullRequestLinkMergedInput,
  parsePullRequestUpsertInput,
  parseQaOutcomeInput,
  parseRepoPathInput,
  parseRepoPullRequestSyncInput,
  parseSetPlanInput,
  parseTaskIdInput,
  parseTaskStopImpactInput,
  parseTransitionTaskInput,
  parseUpdateTaskInput,
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

type TaskCommandService = Omit<TaskService, "qaApproved" | "qaRejected"> &
  Pick<TaskServiceWithMutationProgress, "qaApproved" | "qaRejected">;

export const createTaskCommandHandlers = (taskService: TaskCommandService) =>
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
    human_approve: (args) =>
      taskService.humanApprove(parseTaskIdInput(args, "human_approve input")),
    human_request_changes: (args) =>
      taskService.humanRequestChanges(
        parseOptionalNoteInput(args, "human_request_changes input", "human_request_changes note"),
      ),
    qa_approved: (args) =>
      taskService
        .qaApproved(parseQaOutcomeInput(args, "qa_approved input"))
        .pipe(Effect.map(({ task }) => task)),
    qa_get_report: (args) => taskService.qaGetReport(parseTaskIdInput(args, "qa_get_report input")),
    qa_rejected: (args) =>
      taskService
        .qaRejected(parseQaOutcomeInput(args, "qa_rejected input"))
        .pipe(Effect.map(({ task }) => task)),
    repo_pull_request_sync: (args) =>
      taskService.repoPullRequestSync(parseRepoPullRequestSyncInput(args)),
    task_approval_context_get: (args) =>
      taskService.getApprovalContext(parseTaskIdInput(args, "task_approval_context_get input")),
    task_close: (args) => taskService.closeTask(parseTaskIdInput(args, "task_close input")),
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
    task_transition: (args) => taskService.transitionTask(parseTransitionTaskInput(args)),
    task_update: (args) => taskService.updateTask(parseUpdateTaskInput(args)),
    set_plan: (args) =>
      taskService.setPlan(parseSetPlanInput(args)).pipe(Effect.map(({ artifact }) => artifact)),
    set_spec: (args) =>
      taskService.setSpec(parseMarkdownArtifactInput(args, "set_spec input", "spec")),
    plan_get: (args) => taskService.planGet(parseTaskIdInput(args, "plan_get input")),
    plan_save_artifact: (args) =>
      taskService.savePlanArtifact(
        parseMarkdownArtifactInput(args, "plan_save_artifact input", "implementation plan"),
      ),
    spec_get: (args) => taskService.specGet(parseTaskIdInput(args, "spec_get input")),
    spec_save_artifact: (args) =>
      taskService.saveSpecArtifact(
        parseMarkdownArtifactInput(args, "spec_save_artifact input", "spec"),
      ),
    tasks_list: (args) => taskService.listKanbanTasks(parseRepoPathInput(args, "tasks_list input")),
    tasks_list_all: (args) =>
      taskService.listTasks(parseRepoPathInput(args, "tasks_list_all input")),
    task_ids_list: (args) =>
      taskService.listTaskIds(parseRepoPathInput(args, "task_ids_list input")),
  }) satisfies HostCommandHandlerDefinitions;
