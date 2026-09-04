import {
  agentRoleSchema,
  planSubtaskInputSchema,
  pullRequestSchema,
  taskAssetDescriptionMutationSchema,
  taskCreateInputSchema,
  taskDirectMergeInputSchema,
  taskStatusSchema,
  type TaskStopImpactRequest,
  taskStopImpactRequestSchema,
  taskUpdatePatchSchema,
} from "@openducktor/contracts";
import { z } from "zod";
import type {
  AgentSessionDeleteInput,
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
  TransitionTaskInput,
  UpdateTaskInput,
} from "../../application/tasks/task-inputs";
import { HostValidationError } from "../../effect/host-errors";
import {
  normalizedAgentSessionIdentitySchema,
  optionalBoolean,
  optionalNonNegativeInteger,
  parseAgentSessionIdentity,
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
import {
  commandInputRecordSchema,
  type CommandInputRecord,
  type HostCommandArgs,
  requireParsedRecord,
} from "./command-inputs";

const optionalNonNegativeIntegerSchema = z.union([
  z.number().int().nonnegative(),
  z.null(),
  z.undefined(),
]);
const optionalBooleanSchema = z.union([z.boolean(), z.null(), z.undefined()]);
const optionalStringSchema = z.union([z.string(), z.null(), z.undefined()]);
const taskIdsSchema = z.array(z.unknown());

const readRequiredString = (record: CommandInputRecord, key: string, label: string = key): string =>
  requireString(z.string().safeParse(record[key]), label);

export const parseRepoPathInput = (input: HostCommandArgs, label: string): RepoPathInput => {
  const record = requireParsedRecord(commandInputRecordSchema.safeParse(input), label);
  return { repoPath: readRequiredString(record, "repoPath") };
};

export const parseTaskStopImpactInput = (input: HostCommandArgs): TaskStopImpactRequest => {
  const parsed = taskStopImpactRequestSchema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  throw new HostValidationError({
    message: `task_stop_impact_get input is invalid: ${parsed.error.message}`,
    field: "input",
  });
};

export const parseTaskIdInput = (input: HostCommandArgs, label: string): TaskIdInput => {
  const record = requireParsedRecord(commandInputRecordSchema.safeParse(input), label);
  return {
    repoPath: readRequiredString(record, "repoPath"),
    taskId: readRequiredString(record, "taskId"),
  };
};

export const parseListTasksInput = (input: HostCommandArgs): ListTasksInput => {
  const record = requireParsedRecord(commandInputRecordSchema.safeParse(input), "tasks_list input");
  const repoPath = readRequiredString(record, "repoPath");
  const doneVisibleDays = optionalNonNegativeInteger(
    optionalNonNegativeIntegerSchema.safeParse(record.doneVisibleDays),
    "doneVisibleDays",
  );
  return doneVisibleDays === undefined ? { repoPath } : { repoPath, doneVisibleDays };
};

export const parseListAgentSessionsForTasksInput = (
  input: HostCommandArgs,
): ListAgentSessionsForTasksInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "agent_sessions_list_for_tasks input",
  );
  const parsedTaskIds = taskIdsSchema.safeParse(record.taskIds);
  if (!parsedTaskIds.success) {
    throw new HostValidationError({
      message: "taskIds must be an array of strings.",
      field: "taskIds",
      cause: parsedTaskIds.error,
    });
  }
  const taskIds = parsedTaskIds.data.map((taskId, index) => {
    const field = `taskIds[${index}]`;
    const parsedTaskId = z.string().safeParse(taskId);
    if (!parsedTaskId.success) {
      throw new HostValidationError({
        message: `${field} must be a string.`,
        field,
        cause: parsedTaskId.error,
      });
    }
    return requireString(parsedTaskId, field);
  });

  return {
    repoPath: readRequiredString(record, "repoPath"),
    taskIds: Array.from(new Set(taskIds)),
  };
};

export const parseAgentSessionDeleteInput = (input: HostCommandArgs): AgentSessionDeleteInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "agent_session_delete input",
  );
  return {
    repoPath: readRequiredString(record, "repoPath"),
    taskId: readRequiredString(record, "taskId"),
    identity: parseAgentSessionIdentity(
      normalizedAgentSessionIdentitySchema.safeParse(record.identity),
    ),
  };
};

export const parsePullRequestUpsertInput = (input: HostCommandArgs): PullRequestUpsertInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "task_pull_request_upsert input",
  );
  return {
    repoPath: readRequiredString(record, "repoPath"),
    taskId: readRequiredString(record, "taskId"),
    content: parsePullRequestContent(commandInputRecordSchema.safeParse(record.input)),
  };
};

export const parsePullRequestLinkMergedInput = (
  input: HostCommandArgs,
): PullRequestLinkMergedInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "task_pull_request_link_merged input",
  );
  return {
    repoPath: readRequiredString(record, "repoPath"),
    taskId: readRequiredString(record, "taskId"),
    pullRequest: parsePullRequest(pullRequestSchema.safeParse(record.pullRequest)),
  };
};

export const parseDirectMergeInput = (input: HostCommandArgs): DirectMergeInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "task_direct_merge input",
  );
  return {
    repoPath: readRequiredString(record, "repoPath"),
    taskId: readRequiredString(record, "taskId"),
    input: parseTaskDirectMergeInput(taskDirectMergeInputSchema.safeParse(record.input)),
  };
};

export const parseCreateTaskInput = (input: HostCommandArgs): CreateTaskUseCaseInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "task_create input",
  );
  const descriptionAssets = parseDescriptionAssets(
    taskAssetDescriptionMutationSchema.optional().safeParse(record.descriptionAssets),
  );
  const result: CreateTaskUseCaseInput = {
    repoPath: readRequiredString(record, "repoPath"),
    task: parseCreateInput(taskCreateInputSchema.safeParse(record.input)),
  };
  if (descriptionAssets) {
    result.descriptionAssets = descriptionAssets;
  }
  return result;
};

export const parseDeleteTaskInput = (input: HostCommandArgs): DeleteTaskInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "task_delete input",
  );
  return {
    repoPath: readRequiredString(record, "repoPath"),
    taskId: readRequiredString(record, "taskId"),
    deleteSubtasks:
      optionalBoolean(optionalBooleanSchema.safeParse(record.deleteSubtasks), "deleteSubtasks") ??
      false,
  };
};

export const parseUpdateTaskInput = (input: HostCommandArgs): UpdateTaskInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "task_update input",
  );
  const patch = parseUpdatePatch(taskUpdatePatchSchema.safeParse(record.patch));
  const descriptionAssets = parseDescriptionAssets(
    taskAssetDescriptionMutationSchema.optional().safeParse(record.descriptionAssets),
  );
  if (descriptionAssets && !Object.hasOwn(patch, "description")) {
    throw new HostValidationError({
      message: "descriptionAssets requires a description patch.",
      field: "descriptionAssets",
    });
  }
  const result: UpdateTaskInput = {
    repoPath: readRequiredString(record, "repoPath"),
    taskId: readRequiredString(record, "taskId"),
    patch,
  };
  if (descriptionAssets) {
    result.descriptionAssets = descriptionAssets;
  }
  return result;
};

export const parseTransitionTaskInput = (input: HostCommandArgs): TransitionTaskInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "task_transition input",
  );
  return {
    repoPath: readRequiredString(record, "repoPath"),
    taskId: readRequiredString(record, "taskId"),
    status: parseTransitionStatus(taskStatusSchema.safeParse(record.status)),
  };
};

export const parseMarkdownDocumentInput = (
  input: HostCommandArgs,
  commandLabel: string,
  markdownLabel: string,
): MarkdownDocumentInput => {
  const record = requireParsedRecord(commandInputRecordSchema.safeParse(input), commandLabel);
  return {
    repoPath: readRequiredString(record, "repoPath"),
    taskId: readRequiredString(record, "taskId"),
    markdown: parseRequiredMarkdown(z.string().safeParse(record.markdown), markdownLabel),
  };
};

export const parseQaOutcomeInput = (
  input: HostCommandArgs,
  commandLabel: string,
): MarkdownDocumentInput => {
  const record = requireParsedRecord(commandInputRecordSchema.safeParse(input), commandLabel);
  return {
    repoPath: readRequiredString(record, "repoPath"),
    taskId: readRequiredString(record, "taskId"),
    markdown: parseRequiredMarkdown(z.string().safeParse(record.reportMarkdown), "QA report"),
  };
};

export const parseSetPlanInput = (input: HostCommandArgs): SetPlanInput => {
  const record = requireParsedRecord(commandInputRecordSchema.safeParse(input), "set_plan input");
  const planInput = requireParsedRecord(
    commandInputRecordSchema.safeParse(record.input),
    "set_plan input.input",
  );
  return {
    repoPath: readRequiredString(record, "repoPath"),
    taskId: readRequiredString(record, "taskId"),
    markdown: parseRequiredMarkdown(
      z.string().safeParse(planInput.markdown),
      "implementation plan",
    ),
    subtasks: parsePlanSubtasks(
      planSubtaskInputSchema.array().optional().safeParse(planInput.subtasks),
    ),
    hasExplicitSubtasks: "subtasks" in planInput,
  };
};

export const parseBuildStartInput = (input: HostCommandArgs): BuildStartInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "build_start input",
  );
  return {
    repoPath: readRequiredString(record, "repoPath"),
    taskId: readRequiredString(record, "taskId"),
    runtimeKind: readRequiredString(record, "runtimeKind"),
  };
};

export const parseTaskSessionBootstrapPrepareInput = (
  input: HostCommandArgs,
): TaskSessionBootstrapPrepareInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "task_session_bootstrap_prepare input",
  );
  const parsedRole = agentRoleSchema.safeParse(record.role);
  if (!parsedRole.success) {
    throw new HostValidationError({
      field: "role",
      message: "A supported agent role is required.",
    });
  }
  const parsedTargetWorkingDirectory = z.string().safeParse(record.targetWorkingDirectory);
  const targetWorkingDirectory = parsedTargetWorkingDirectory.success
    ? parsedTargetWorkingDirectory.data.trim() || undefined
    : undefined;
  const result: TaskSessionBootstrapPrepareInput = {
    repoPath: readRequiredString(record, "repoPath"),
    taskId: readRequiredString(record, "taskId"),
    runtimeKind: readRequiredString(record, "runtimeKind"),
    role: parsedRole.data,
  };
  if (targetWorkingDirectory) {
    result.targetWorkingDirectory = targetWorkingDirectory;
  }
  return result;
};

export const parseTaskSessionBootstrapFinalizeInput = (
  input: HostCommandArgs,
  label: string,
): TaskSessionBootstrapFinalizeInput => {
  const record = requireParsedRecord(commandInputRecordSchema.safeParse(input), label);
  return {
    repoPath: readRequiredString(record, "repoPath"),
    taskId: readRequiredString(record, "taskId"),
    bootstrapId: readRequiredString(record, "bootstrapId"),
  };
};

export const parseBuildBlockedInput = (input: HostCommandArgs): BuildBlockedInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "build_blocked input",
  );
  const parsedReason = z.string().safeParse(record.reason);
  const reason = parsedReason.success ? parsedReason.data.trim() : "";
  if (!reason) {
    throw new HostValidationError({
      message: "build_blocked requires a non-empty reason",
      field: "reason",
    });
  }
  return {
    repoPath: readRequiredString(record, "repoPath"),
    taskId: readRequiredString(record, "taskId"),
    reason,
  };
};

export const parseBuildCompletedInput = (input: HostCommandArgs): BuildCompletedInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "build_completed input",
  );
  const inputRecord =
    record.input === undefined || record.input === null
      ? undefined
      : requireParsedRecord(
          commandInputRecordSchema.safeParse(record.input),
          "build_completed input.input",
        );
  const summary = parseOptionalNote(
    optionalStringSchema.safeParse(inputRecord?.summary),
    "build_completed summary",
  );
  const result: BuildCompletedInput = {
    repoPath: readRequiredString(record, "repoPath"),
    taskId: readRequiredString(record, "taskId"),
  };
  if (summary !== undefined) {
    result.summary = summary;
  }
  return result;
};

export const parseOptionalNoteInput = (
  input: HostCommandArgs,
  label: string,
  noteLabel: string,
): OptionalNoteInput => {
  const record = requireParsedRecord(commandInputRecordSchema.safeParse(input), label);
  const note = parseOptionalNote(optionalStringSchema.safeParse(record.note), noteLabel);
  const result: OptionalNoteInput = {
    repoPath: readRequiredString(record, "repoPath"),
    taskId: readRequiredString(record, "taskId"),
  };
  if (note !== undefined) {
    result.note = note;
  }
  return result;
};
