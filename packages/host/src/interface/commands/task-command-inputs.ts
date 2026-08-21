import { agentRoleSchema } from "@openducktor/contracts";
import type { JsonValue } from "@openducktor/contracts";
import type {
  AgentSessionDeleteInput,
  AgentSessionUpsertInput,
  BuildBlockedInput,
  BuildCompletedInput,
  BuildStartInput,
  CreateTaskUseCaseInput,
  DeleteTaskInput,
  DirectMergeInput,
  ListAgentSessionsForTasksInput,
  ListTasksInput,
  MarkdownDocumentInput,
  OptionalNoteInput,
  PullRequestLinkMergedInput,
  PullRequestUpsertInput,
  RepoPathInput,
  SetPlanInput,
  TaskIdInput,
  TaskSessionBootstrapFinalizeInput,
  TaskSessionBootstrapPrepareInput,
  TaskSessionStartupLeaseFinalizeInput,
  TaskSessionStartupLeasePrepareInput,
  TransitionTaskInput,
  UpdateTaskInput,
} from "../../application/tasks/task-inputs";
import { HostValidationError } from "../../effect/host-errors";
import {
  compactAgentSessionForStorage,
  optionalBoolean,
  optionalNonNegativeInteger,
  parseAgentSessionIdentity,
  parseAgentSessionRecord,
  parseCreateInput,
  parseDescriptionAssets,
  parseOptionalNote,
  parsePlanSubtasks,
  parsePullRequest,
  parsePullRequestContent,
  parseRequiredMarkdown,
  parseTaskDirectMergeInput,
  parseTransitionStatus,
  parseUpdatePatch,
  requireRecord,
  requireString,
} from "./task-command-parsing";

export const parseRepoPathInput = (input: JsonValue | undefined, label: string): RepoPathInput => {
  const record = requireRecord(input, label);
  return { repoPath: requireString(record.repoPath, "repoPath") };
};

export const parseTaskIdInput = (input: JsonValue | undefined, label: string): TaskIdInput => {
  const record = requireRecord(input, label);
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
  };
};

export const parseListTasksInput = (input: JsonValue | undefined): ListTasksInput => {
  const record = requireRecord(input, "tasks_list input");
  const repoPath = requireString(record.repoPath, "repoPath");
  const doneVisibleDays = optionalNonNegativeInteger(record.doneVisibleDays, "doneVisibleDays");
  return doneVisibleDays === undefined ? { repoPath } : { repoPath, doneVisibleDays };
};

export const parseListAgentSessionsForTasksInput = (
  input: JsonValue | undefined,
): ListAgentSessionsForTasksInput => {
  const record = requireRecord(input, "agent_sessions_list_for_tasks input");
  if (!Array.isArray(record.taskIds)) {
    throw new HostValidationError({
      message: "taskIds must be an array of strings.",
      field: "taskIds",
      details: { value: record.taskIds },
    });
  }
  const taskIds = record.taskIds.map((taskId, index) => {
    const field = `taskIds[${index}]`;
    if (typeof taskId !== "string") {
      throw new HostValidationError({
        message: `${field} must be a string.`,
        field,
        details: { value: taskId },
      });
    }
    return requireString(taskId, field);
  });

  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskIds: Array.from(new Set(taskIds)),
  };
};

export const parseAgentSessionUpsertInput = (
  input: JsonValue | undefined,
): AgentSessionUpsertInput => {
  const record = requireRecord(input, "agent_session_upsert input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    session: compactAgentSessionForStorage(parseAgentSessionRecord(record.session)),
  };
};

export const parseAgentSessionDeleteInput = (
  input: JsonValue | undefined,
): AgentSessionDeleteInput => {
  const record = requireRecord(input, "agent_session_delete input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    identity: parseAgentSessionIdentity(record.identity),
  };
};

export const parsePullRequestUpsertInput = (
  input: JsonValue | undefined,
): PullRequestUpsertInput => {
  const record = requireRecord(input, "task_pull_request_upsert input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    content: parsePullRequestContent(record.input),
  };
};

export const parsePullRequestLinkMergedInput = (
  input: JsonValue | undefined,
): PullRequestLinkMergedInput => {
  const record = requireRecord(input, "task_pull_request_link_merged input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    pullRequest: parsePullRequest(record.pullRequest),
  };
};

export const parseDirectMergeInput = (input: JsonValue | undefined): DirectMergeInput => {
  const record = requireRecord(input, "task_direct_merge input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    input: parseTaskDirectMergeInput(record.input),
  };
};

export const parseCreateTaskInput = (input: JsonValue | undefined): CreateTaskUseCaseInput => {
  const record = requireRecord(input, "task_create input");
  const descriptionAssets = parseDescriptionAssets(record.descriptionAssets);
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    task: parseCreateInput(record.input),
    ...(descriptionAssets ? { descriptionAssets } : {}),
  };
};

export const parseDeleteTaskInput = (input: JsonValue | undefined): DeleteTaskInput => {
  const record = requireRecord(input, "task_delete input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    deleteSubtasks: optionalBoolean(record.deleteSubtasks, "deleteSubtasks") ?? false,
  };
};

export const parseUpdateTaskInput = (input: JsonValue | undefined): UpdateTaskInput => {
  const record = requireRecord(input, "task_update input");
  const patch = parseUpdatePatch(record.patch);
  const descriptionAssets = parseDescriptionAssets(record.descriptionAssets);
  if (descriptionAssets && !Object.hasOwn(patch, "description")) {
    throw new HostValidationError({
      message: "descriptionAssets requires a description patch.",
      field: "descriptionAssets",
    });
  }
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    patch,
    ...(descriptionAssets ? { descriptionAssets } : {}),
  };
};

export const parseTransitionTaskInput = (input: JsonValue | undefined): TransitionTaskInput => {
  const record = requireRecord(input, "task_transition input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    status: parseTransitionStatus(record.status),
  };
};

export const parseMarkdownDocumentInput = (
  input: JsonValue | undefined,
  commandLabel: string,
  markdownLabel: string,
): MarkdownDocumentInput => {
  const record = requireRecord(input, commandLabel);
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    markdown: parseRequiredMarkdown(record.markdown, markdownLabel),
  };
};

export const parseQaOutcomeInput = (
  input: JsonValue | undefined,
  commandLabel: string,
): MarkdownDocumentInput => {
  const record = requireRecord(input, commandLabel);
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    markdown: parseRequiredMarkdown(record.reportMarkdown, "QA report"),
  };
};

export const parseSetPlanInput = (input: JsonValue | undefined): SetPlanInput => {
  const record = requireRecord(input, "set_plan input");
  const planInput = requireRecord(record.input, "set_plan input.input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    markdown: parseRequiredMarkdown(planInput.markdown, "implementation plan"),
    subtasks: parsePlanSubtasks(planInput.subtasks),
    hasExplicitSubtasks: "subtasks" in planInput,
  };
};

export const parseBuildStartInput = (input: JsonValue | undefined): BuildStartInput => {
  const record = requireRecord(input, "build_start input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    runtimeKind: requireString(record.runtimeKind, "runtimeKind"),
  };
};

export const parseTaskSessionBootstrapPrepareInput = (
  input: JsonValue | undefined,
): TaskSessionBootstrapPrepareInput => {
  const record = requireRecord(input, "task_session_bootstrap_prepare input");
  const parsedRole = agentRoleSchema.safeParse(record.role);
  if (!parsedRole.success) {
    throw new HostValidationError({
      field: "role",
      message: "A supported agent role is required.",
    });
  }
  const targetWorkingDirectory =
    typeof record.targetWorkingDirectory === "string" && record.targetWorkingDirectory.trim()
      ? record.targetWorkingDirectory.trim()
      : undefined;
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    runtimeKind: requireString(record.runtimeKind, "runtimeKind"),
    role: parsedRole.data,
    ...(targetWorkingDirectory ? { targetWorkingDirectory } : {}),
  };
};

export const parseTaskSessionBootstrapFinalizeInput = (
  input: JsonValue | undefined,
  label: string,
): TaskSessionBootstrapFinalizeInput => {
  const record = requireRecord(input, label);
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    bootstrapId: requireString(record.bootstrapId, "bootstrapId"),
  };
};

export const parseTaskSessionStartupLeasePrepareInput = (
  input: JsonValue | undefined,
): TaskSessionStartupLeasePrepareInput => {
  const record = requireRecord(input, "task_session_startup_lease_prepare input");
  const role = agentRoleSchema.safeParse(record.role);
  if (!role.success)
    throw new HostValidationError({
      field: "role",
      message: "A supported agent role is required.",
    });
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    role: role.data,
  };
};

export const parseTaskSessionStartupLeaseFinalizeInput = (
  input: JsonValue | undefined,
  label: string,
): TaskSessionStartupLeaseFinalizeInput => {
  const record = requireRecord(input, label);
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    leaseId: requireString(record.leaseId, "leaseId"),
  };
};

export const parseBuildBlockedInput = (input: JsonValue | undefined): BuildBlockedInput => {
  const record = requireRecord(input, "build_blocked input");
  const reason = typeof record.reason === "string" ? record.reason.trim() : "";
  if (!reason) {
    throw new HostValidationError({
      message: "build_blocked requires a non-empty reason",
      field: "reason",
    });
  }
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    reason,
  };
};

export const parseBuildCompletedInput = (input: JsonValue | undefined): BuildCompletedInput => {
  const record = requireRecord(input, "build_completed input");
  const inputRecord =
    record.input === undefined || record.input === null
      ? undefined
      : requireRecord(record.input, "build_completed input.input");
  const summary = parseOptionalNote(inputRecord?.summary, "build_completed summary");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    ...(summary === undefined ? {} : { summary }),
  };
};

export const parseOptionalNoteInput = (
  input: JsonValue | undefined,
  label: string,
  noteLabel: string,
): OptionalNoteInput => {
  const record = requireRecord(input, label);
  const note = parseOptionalNote(record.note, noteLabel);
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    ...(note === undefined ? {} : { note }),
  };
};
