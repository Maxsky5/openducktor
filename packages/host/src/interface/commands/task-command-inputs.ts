import type {
  AgentSessionUpsertInput,
  BuildBlockedInput,
  BuildCompletedInput,
  BuildStartInput,
  CreateTaskUseCaseInput,
  DeleteTaskInput,
  DirectMergeInput,
  ListTasksInput,
  MarkdownDocumentInput,
  OptionalNoteInput,
  PullRequestLinkMergedInput,
  PullRequestNumberInput,
  PullRequestUpsertInput,
  RepoPathInput,
  SetPlanInput,
  TaskIdInput,
  TransitionTaskInput,
  UpdateTaskInput,
} from "../../application/tasks/task-inputs";
import {
  compactAgentSessionForStorage,
  optionalBoolean,
  optionalNonNegativeInteger,
  parseAgentSessionRecord,
  parseCreateInput,
  parseOptionalNote,
  parsePlanSubtasks,
  parsePullRequest,
  parsePullRequestContent,
  parseRequiredMarkdown,
  parseTaskDirectMergeInput,
  parseTaskIdList,
  parseTransitionStatus,
  parseUpdatePatch,
  requirePositiveInteger,
  requireRecord,
  requireString,
} from "./task-command-parsing";

export const parseRepoPathInput = (input: unknown, label: string): RepoPathInput => {
  const record = requireRecord(input, label);
  return { repoPath: requireString(record.repoPath, "repoPath") };
};

export const parseTaskIdInput = (input: unknown, label: string): TaskIdInput => {
  const record = requireRecord(input, label);
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
  };
};

export const parseListTasksInput = (input: unknown): ListTasksInput => {
  const record = requireRecord(input, "tasks_list input");
  const repoPath = requireString(record.repoPath, "repoPath");
  const doneVisibleDays = optionalNonNegativeInteger(record.doneVisibleDays, "doneVisibleDays");
  return doneVisibleDays === undefined ? { repoPath } : { repoPath, doneVisibleDays };
};

export const parseAgentSessionsListBulkInput = (
  input: unknown,
): { repoPath: string; taskIds: string[] } => {
  const record = requireRecord(input, "agent_sessions_list_bulk input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskIds: parseTaskIdList(record.taskIds, "taskIds"),
  };
};

export const parseAgentSessionUpsertInput = (input: unknown): AgentSessionUpsertInput => {
  const record = requireRecord(input, "agent_session_upsert input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    session: compactAgentSessionForStorage(parseAgentSessionRecord(record.session)),
  };
};

export const parsePullRequestNumberInput = (
  input: unknown,
  label: string,
): PullRequestNumberInput => {
  const record = requireRecord(input, label);
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    providerId: requireString(record.providerId, "providerId"),
    number: requirePositiveInteger(record.number, "number"),
  };
};

export const parsePullRequestUpsertInput = (input: unknown): PullRequestUpsertInput => {
  const record = requireRecord(input, "task_pull_request_upsert input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    content: parsePullRequestContent(record.input),
  };
};

export const parsePullRequestLinkMergedInput = (input: unknown): PullRequestLinkMergedInput => {
  const record = requireRecord(input, "task_pull_request_link_merged input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    pullRequest: parsePullRequest(record.pullRequest),
  };
};

export const parseDirectMergeInput = (input: unknown): DirectMergeInput => {
  const record = requireRecord(input, "task_direct_merge input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    input: parseTaskDirectMergeInput(record.input),
  };
};

export const parseCreateTaskInput = (input: unknown): CreateTaskUseCaseInput => {
  const record = requireRecord(input, "task_create input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    task: parseCreateInput(record.input),
  };
};

export const parseDeleteTaskInput = (input: unknown): DeleteTaskInput => {
  const record = requireRecord(input, "task_delete input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    deleteSubtasks: optionalBoolean(record.deleteSubtasks, "deleteSubtasks") ?? false,
  };
};

export const parseUpdateTaskInput = (input: unknown): UpdateTaskInput => {
  const record = requireRecord(input, "task_update input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    patch: parseUpdatePatch(record.patch),
  };
};

export const parseTransitionTaskInput = (input: unknown): TransitionTaskInput => {
  const record = requireRecord(input, "task_transition input");
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
  const record = requireRecord(input, commandLabel);
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
  const record = requireRecord(input, commandLabel);
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    markdown: parseRequiredMarkdown(record.reportMarkdown, "QA report"),
  };
};

export const parseSetPlanInput = (input: unknown): SetPlanInput => {
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

export const parseBuildStartInput = (input: unknown): BuildStartInput => {
  const record = requireRecord(input, "build_start input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    runtimeKind: requireString(record.runtimeKind, "runtimeKind"),
  };
};

export const parseBuildBlockedInput = (input: unknown): BuildBlockedInput => {
  const record = requireRecord(input, "build_blocked input");
  const reason = typeof record.reason === "string" ? record.reason.trim() : "";
  if (!reason) {
    throw new Error("build_blocked requires a non-empty reason");
  }
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    taskId: requireString(record.taskId, "taskId"),
    reason,
  };
};

export const parseBuildCompletedInput = (input: unknown): BuildCompletedInput => {
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
  input: unknown,
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
