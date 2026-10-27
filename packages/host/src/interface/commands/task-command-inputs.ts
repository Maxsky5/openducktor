import {
  repoPullRequestSyncRequestSchema,
  taskDirectMergeCompleteIntentSchema,
} from "@openducktor/contracts";
import {
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
  WorkflowArtifactInput,
  WorkflowArtifactSaveInput,
  OptionalNoteInput,
  PullRequestLinkMergedInput,
  PullRequestUpsertInput,
  RepoPathInput,
  TaskIdInput,
  TransitionTaskInput,
  ApplyTaskEventInput,
  UpdateTaskInput,
} from "../../application/tasks/task-inputs";
import { HostValidationError } from "../../effect/host-errors";
import {
  normalizedAgentSessionIdentitySchema,
  parseAgentSessionIdentity,
  parseCreateInput,
  parseDescriptionAssets,
  parseOptionalNote,
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
  commandInputStringSchema,
  type CommandInputRecord,
  type HostCommandArgs,
  requireParsedRecord,
} from "./command-inputs";

const optionalStringSchema = z.union([z.string(), z.null(), z.undefined()]);
const taskIdsSchema = z.array(z.unknown());

const optionalDescriptionAssetsSchema = taskAssetDescriptionMutationSchema.optional();

const readRequiredString = (record: CommandInputRecord, key: string, label: string = key): string =>
  requireString(commandInputStringSchema.safeParse(record[key]), label);

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
    const parsedTaskId = commandInputStringSchema.safeParse(taskId);
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
    optionalDescriptionAssetsSchema.safeParse(record.descriptionAssets),
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
  };
};

export const parseUpdateTaskInput = (input: HostCommandArgs): UpdateTaskInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "task_update input",
  );
  const patch = parseUpdatePatch(taskUpdatePatchSchema.safeParse(record.patch));
  const descriptionAssets = parseDescriptionAssets(
    optionalDescriptionAssetsSchema.safeParse(record.descriptionAssets),
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

export const parseApplyTaskEventInput = (input: HostCommandArgs): ApplyTaskEventInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "task_apply_event input",
  );
  return {
    repoPath: readRequiredString(record, "repoPath"),
    taskId: readRequiredString(record, "taskId"),
    eventId: readRequiredString(record, "eventId"),
  };
};

export const parseWorkflowArtifactInput = (input: HostCommandArgs): WorkflowArtifactInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "workflow_artifact_get input",
  );
  return {
    repoPath: readRequiredString(record, "repoPath"),
    taskId: readRequiredString(record, "taskId"),
    code: readRequiredString(record, "code"),
  };
};

export const parseWorkflowArtifactSaveInput = (
  input: HostCommandArgs,
): WorkflowArtifactSaveInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "workflow_artifact_save input",
  );
  const code = readRequiredString(record, "code");
  const submit = z.boolean().safeParse(record.submit);
  if (!submit.success) {
    throw new HostValidationError({
      field: "submit",
      message: "workflow_artifact_save input.submit must be true or false.",
    });
  }
  const parsed: WorkflowArtifactSaveInput = {
    repoPath: readRequiredString(record, "repoPath"),
    taskId: readRequiredString(record, "taskId"),
    code,
    markdown: parseRequiredMarkdown(commandInputStringSchema.safeParse(record.markdown), code),
    submit: submit.data,
    sourceTool: "workflow_artifact_save",
    updatedBy: "user",
  };
  if (record.verdict !== undefined) parsed.verdict = readRequiredString(record, "verdict");
  return parsed;
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

export const parseBuildBlockedInput = (input: HostCommandArgs): BuildBlockedInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "build_blocked input",
  );
  const parsedReason = commandInputStringSchema.safeParse(record.reason);
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

export const parseDirectMergeCompleteInput = (input: HostCommandArgs) => {
  const result = taskDirectMergeCompleteIntentSchema.safeParse(input);
  if (!result.success)
    throw new HostValidationError({
      field: "publicationConsent",
      message: `Invalid completion intent: ${result.error.message}`,
    });
  return result.data;
};

export const parseRepoPullRequestSyncInput = (input: HostCommandArgs) => {
  const parsed = repoPullRequestSyncRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new HostValidationError({
      message: `repo_pull_request_sync input is invalid: ${parsed.error.message}`,
      field: "input",
    });
  }
  return parsed.data;
};
