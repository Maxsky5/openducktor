import { agentRoleSchema } from "@openducktor/contracts";
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
  requireString,
} from "./task-command-parsing";
import { requireParsedRecord, unknownRecordSchema } from "./command-inputs";

export const parseRepoPathInput = (input: unknown, label: string): RepoPathInput => {
  const record = requireParsedRecord(unknownRecordSchema.safeParse(input), label);
  return { repoPath: requireString(record.repoPath, "repoPath") };
};

export const parseTaskIdInput = (input: unknown, label: string): TaskIdInput => {
  const record = requireParsedRecord(unknownRecordSchema.safeParse(input), label);
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
  };
};

export const parseListTasksInput = (input: unknown): ListTasksInput => {
  const record = requireParsedRecord(unknownRecordSchema.safeParse(input), "tasks_list input");
  const repoPath = requireString(record.repoPath, "repoPath");
  const doneVisibleDays = optionalNonNegativeInteger(record.doneVisibleDays, "doneVisibleDays");
  return doneVisibleDays === undefined ? { repoPath } : { repoPath, doneVisibleDays };
};

export const parseListAgentSessionsForTasksInput = (
  input: unknown,
): ListAgentSessionsForTasksInput => {
  const record = requireParsedRecord(
    unknownRecordSchema.safeParse(input),
    "agent_sessions_list_for_tasks input",
  );
  if (!Array.isArray(record.taskIds)) {
    throw new HostValidationError({
      message: "taskIds must be an array of strings.",
      field: "taskIds",
      details: { receivedValueTag: Object.prototype.toString.call(record.taskIds) },
    });
  }
  const taskIds = record.taskIds.map((taskId, index) => {
    const field = `taskIds[${index}]`;
    if (typeof taskId !== "string") {
      throw new HostValidationError({
        message: `${field} must be a string.`,
        field,
        details: { receivedValueTag: Object.prototype.toString.call(taskId) },
      });
    }
    return requireString(taskId, field);
  });

  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskIds: Array.from(new Set(taskIds)),
  };
};

export const parseAgentSessionUpsertInput = (input: unknown): AgentSessionUpsertInput => {
  const record = requireParsedRecord(
    unknownRecordSchema.safeParse(input),
    "agent_session_upsert input",
  );
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    session: compactAgentSessionForStorage(parseAgentSessionRecord(record.session)),
  };
};

export const parseAgentSessionDeleteInput = (input: unknown): AgentSessionDeleteInput => {
  const record = requireParsedRecord(
    unknownRecordSchema.safeParse(input),
    "agent_session_delete input",
  );
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    identity: parseAgentSessionIdentity(record.identity),
  };
};

export const parsePullRequestUpsertInput = (input: unknown): PullRequestUpsertInput => {
  const record = requireParsedRecord(
    unknownRecordSchema.safeParse(input),
    "task_pull_request_upsert input",
  );
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    content: parsePullRequestContent(record.input),
  };
};

export const parsePullRequestLinkMergedInput = (input: unknown): PullRequestLinkMergedInput => {
  const record = requireParsedRecord(
    unknownRecordSchema.safeParse(input),
    "task_pull_request_link_merged input",
  );
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    pullRequest: parsePullRequest(record.pullRequest),
  };
};

export const parseDirectMergeInput = (input: unknown): DirectMergeInput => {
  const record = requireParsedRecord(
    unknownRecordSchema.safeParse(input),
    "task_direct_merge input",
  );
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    input: parseTaskDirectMergeInput(record.input),
  };
};

export const parseCreateTaskInput = (input: unknown): CreateTaskUseCaseInput => {
  const record = requireParsedRecord(unknownRecordSchema.safeParse(input), "task_create input");
  const descriptionAssets = parseDescriptionAssets(record.descriptionAssets);
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    task: parseCreateInput(record.input),
    ...(descriptionAssets ? { descriptionAssets } : undefined),
  };
};

export const parseDeleteTaskInput = (input: unknown): DeleteTaskInput => {
  const record = requireParsedRecord(unknownRecordSchema.safeParse(input), "task_delete input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    deleteSubtasks: optionalBoolean(record.deleteSubtasks, "deleteSubtasks") ?? false,
  };
};

export const parseUpdateTaskInput = (input: unknown): UpdateTaskInput => {
  const record = requireParsedRecord(unknownRecordSchema.safeParse(input), "task_update input");
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
    ...(descriptionAssets ? { descriptionAssets } : undefined),
  };
};

export const parseTransitionTaskInput = (input: unknown): TransitionTaskInput => {
  const record = requireParsedRecord(unknownRecordSchema.safeParse(input), "task_transition input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    status: parseTransitionStatus(record.status),
  };
};

export const parseMarkdownDocumentInput = (
  input: unknown,
  commandLabel: string,
  markdownLabel: string,
): MarkdownDocumentInput => {
  const record = requireParsedRecord(unknownRecordSchema.safeParse(input), commandLabel);
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    markdown: parseRequiredMarkdown(record.markdown, markdownLabel),
  };
};

export const parseQaOutcomeInput = (
  input: unknown,
  commandLabel: string,
): MarkdownDocumentInput => {
  const record = requireParsedRecord(unknownRecordSchema.safeParse(input), commandLabel);
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    markdown: parseRequiredMarkdown(record.reportMarkdown, "QA report"),
  };
};

export const parseSetPlanInput = (input: unknown): SetPlanInput => {
  const record = requireParsedRecord(unknownRecordSchema.safeParse(input), "set_plan input");
  const planInput = requireParsedRecord(
    unknownRecordSchema.safeParse(record.input),
    "set_plan input.input",
  );
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    markdown: parseRequiredMarkdown(planInput.markdown, "implementation plan"),
    subtasks: parsePlanSubtasks(planInput.subtasks),
    hasExplicitSubtasks: "subtasks" in planInput,
  };
};

export const parseBuildStartInput = (input: unknown): BuildStartInput => {
  const record = requireParsedRecord(unknownRecordSchema.safeParse(input), "build_start input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    runtimeKind: requireString(record.runtimeKind, "runtimeKind"),
  };
};

export const parseTaskSessionBootstrapPrepareInput = (
  input: unknown,
): TaskSessionBootstrapPrepareInput => {
  const record = requireParsedRecord(
    unknownRecordSchema.safeParse(input),
    "task_session_bootstrap_prepare input",
  );
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
    ...(targetWorkingDirectory ? { targetWorkingDirectory } : undefined),
  };
};

export const parseTaskSessionBootstrapFinalizeInput = (
  input: unknown,
  label: string,
): TaskSessionBootstrapFinalizeInput => {
  const record = requireParsedRecord(unknownRecordSchema.safeParse(input), label);
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    bootstrapId: requireString(record.bootstrapId, "bootstrapId"),
  };
};

export const parseTaskSessionStartupLeasePrepareInput = (
  input: unknown,
): TaskSessionStartupLeasePrepareInput => {
  const record = requireParsedRecord(
    unknownRecordSchema.safeParse(input),
    "task_session_startup_lease_prepare input",
  );
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
  input: unknown,
  label: string,
): TaskSessionStartupLeaseFinalizeInput => {
  const record = requireParsedRecord(unknownRecordSchema.safeParse(input), label);
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    leaseId: requireString(record.leaseId, "leaseId"),
  };
};

export const parseBuildBlockedInput = (input: unknown): BuildBlockedInput => {
  const record = requireParsedRecord(unknownRecordSchema.safeParse(input), "build_blocked input");
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

export const parseBuildCompletedInput = (input: unknown): BuildCompletedInput => {
  const record = requireParsedRecord(unknownRecordSchema.safeParse(input), "build_completed input");
  const inputRecord =
    record.input === undefined || record.input === null
      ? undefined
      : requireParsedRecord(
          unknownRecordSchema.safeParse(record.input),
          "build_completed input.input",
        );
  const summary = parseOptionalNote(inputRecord?.summary, "build_completed summary");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    ...(summary === undefined ? undefined : { summary }),
  };
};

export const parseOptionalNoteInput = (
  input: unknown,
  label: string,
  noteLabel: string,
): OptionalNoteInput => {
  const record = requireParsedRecord(unknownRecordSchema.safeParse(input), label);
  const note = parseOptionalNote(record.note, noteLabel);
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    ...(note === undefined ? undefined : { note }),
  };
};
