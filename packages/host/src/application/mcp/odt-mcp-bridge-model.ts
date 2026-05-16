import {
  ODT_HOST_BRIDGE_RESPONSE_SCHEMAS,
  ODT_TOOL_SCHEMAS,
  type OdtPersistedDocument,
  type OdtToolName,
  type PublicTask,
  type PublicTaskSummaryTask,
  type TaskCard,
  type TaskMetadataDocument,
  type TaskMetadataPayload,
  type TaskSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";

type OdtToolInput<Name extends OdtToolName> = ReturnType<(typeof ODT_TOOL_SCHEMAS)[Name]["parse"]>;

const MAX_TASK_CANDIDATES = 5;

export const normalizeKey = (value: string): string => value.trim().toLowerCase();

const sanitizeSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const formatTaskRef = (task: TaskCard): string => `${task.id} (${task.title})`;

const ambiguousTaskError = (requested: string, matches: TaskCard[]): HostValidationError =>
  new HostValidationError({
    field: "taskId",
    message: `Task identifier "${requested}" is ambiguous. Use exact task id. Candidates: ${matches
      .slice(0, MAX_TASK_CANDIDATES)
      .map(formatTaskRef)
      .join(", ")}`,
    details: { taskId: requested },
  });

const singleTaskMatch = (matches: TaskCard[]): TaskCard | null => {
  const [match] = matches;
  return matches.length === 1 && match ? match : null;
};

export const resolveTaskReference = (tasks: TaskCard[], requestedTaskId: string): TaskCard => {
  const requestedLiteral = requestedTaskId.trim();
  if (!requestedLiteral) {
    throw new HostValidationError({
      field: "taskId",
      message: "Missing taskId.",
    });
  }
  const requestedLower = normalizeKey(requestedLiteral);
  const requestedSlug = sanitizeSlug(requestedLiteral);
  const exact = tasks.find((task) => task.id === requestedLiteral);
  if (exact) {
    return exact;
  }
  const caseInsensitiveId = tasks.filter((task) => normalizeKey(task.id) === requestedLower);
  const singleCaseInsensitiveId = singleTaskMatch(caseInsensitiveId);
  if (singleCaseInsensitiveId) {
    return singleCaseInsensitiveId;
  }
  if (caseInsensitiveId.length > 1) {
    throw ambiguousTaskError(requestedTaskId, caseInsensitiveId);
  }
  if (requestedSlug) {
    const byIdSegment = tasks.filter((task) => {
      const normalizedId = normalizeKey(task.id);
      return (
        normalizedId === requestedSlug ||
        normalizedId.split("-").some((segment) => segment === requestedSlug)
      );
    });
    const singleIdSegment = singleTaskMatch(byIdSegment);
    if (singleIdSegment) {
      return singleIdSegment;
    }
    if (byIdSegment.length > 1) {
      throw ambiguousTaskError(requestedTaskId, byIdSegment);
    }
  }
  const byTitleExact = tasks.filter((task) => normalizeKey(task.title) === requestedLower);
  const singleTitleExact = singleTaskMatch(byTitleExact);
  if (singleTitleExact) {
    return singleTitleExact;
  }
  if (byTitleExact.length > 1) {
    throw ambiguousTaskError(requestedTaskId, byTitleExact);
  }
  if (requestedSlug) {
    const byTitleSlug = tasks.filter((task) => sanitizeSlug(task.title) === requestedSlug);
    const singleTitleSlug = singleTaskMatch(byTitleSlug);
    if (singleTitleSlug) {
      return singleTitleSlug;
    }
    if (byTitleSlug.length > 1) {
      throw ambiguousTaskError(requestedTaskId, byTitleSlug);
    }
  }
  const byTitleContains = tasks
    .filter((task) => {
      const titleLower = normalizeKey(task.title);
      const titleSlug = sanitizeSlug(task.title);
      return (
        (requestedLower && titleLower.includes(requestedLower)) ||
        (requestedSlug && titleSlug.includes(requestedSlug))
      );
    })
    .slice(0, MAX_TASK_CANDIDATES + 1);
  const singleTitleContains = singleTaskMatch(byTitleContains);
  if (singleTitleContains) {
    return singleTitleContains;
  }
  if (byTitleContains.length > 1) {
    throw ambiguousTaskError(requestedTaskId, byTitleContains);
  }
  const hints = tasks
    .filter((task) => {
      const idLower = normalizeKey(task.id);
      const titleLower = normalizeKey(task.title);
      const titleSlug = sanitizeSlug(task.title);
      return (
        (requestedLower &&
          (idLower.includes(requestedLower) || titleLower.includes(requestedLower))) ||
        (requestedSlug && (idLower.includes(requestedSlug) || titleSlug.includes(requestedSlug)))
      );
    })
    .slice(0, MAX_TASK_CANDIDATES);
  const candidates = hints.length > 0 ? hints : tasks.slice(0, MAX_TASK_CANDIDATES);
  if (candidates.length === 0) {
    throw new HostValidationError({
      field: "taskId",
      message: `Task not found: ${requestedTaskId}.`,
      details: { taskId: requestedTaskId },
    });
  }
  throw new HostValidationError({
    field: "taskId",
    message: `Task not found: ${requestedTaskId}. Candidate task ids: ${candidates
      .map(formatTaskRef)
      .join(", ")}`,
    details: { taskId: requestedTaskId },
  });
};

const taskDocuments = (task: TaskCard): PublicTaskSummaryTask["documents"] => ({
  hasSpec: Boolean(task.documentSummary.spec.has),
  hasPlan: Boolean(task.documentSummary.plan.has),
  hasQaReport: Boolean(task.documentSummary.qaReport.has),
});

export const mapPublicTask = (task: TaskCard): PublicTask => ({
  id: task.id,
  title: task.title,
  description: task.description ?? "",
  status: task.status,
  priority: task.priority,
  issueType: task.issueType,
  aiReviewEnabled: task.aiReviewEnabled,
  labels: task.labels,
  ...(task.targetBranch ? { targetBranch: task.targetBranch } : {}),
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
});

export const mapTaskSummary = (task: TaskCard): TaskSummary => ({
  task: {
    ...mapPublicTask(task),
    qaVerdict: task.documentSummary.qaReport.verdict,
    documents: taskDocuments(task),
  },
});

export const persistedDocument = (
  document: TaskMetadataDocument,
  operation: string,
): OdtPersistedDocument => {
  if (document.revision === undefined || document.revision < 1) {
    throw new HostOperationError({
      operation,
      message: `Missing persisted document revision for ${operation}.`,
    });
  }
  if (!document.updatedAt) {
    throw new HostOperationError({
      operation,
      message: `Missing persisted document updatedAt for ${operation}.`,
    });
  }
  return {
    markdown: document.markdown,
    updatedAt: document.updatedAt,
    revision: document.revision,
  };
};

export const latestDocument = (document: TaskMetadataDocument) => ({
  markdown: document.markdown,
  updatedAt: document.updatedAt ?? null,
  ...(document.error ? { error: document.error } : {}),
});

export const latestQaReport = (qaReport: TaskMetadataPayload["qaReport"]) =>
  qaReport
    ? {
        markdown: qaReport.markdown,
        updatedAt: qaReport.updatedAt ?? null,
        verdict: qaReport.verdict,
        ...(qaReport.error ? { error: qaReport.error } : {}),
      }
    : undefined;

export const activeStatuses = new Set([
  "open",
  "spec_ready",
  "ready_for_dev",
  "in_progress",
  "blocked",
  "ai_review",
  "human_review",
]);

export const directSubtaskIds = (tasks: TaskCard[], taskId: string): Set<string> =>
  new Set(tasks.filter((task) => task.parentId === taskId).map((task) => task.id));

export const createdSubtaskIds = (
  before: Set<string>,
  after: TaskCard[],
  taskId: string,
): string[] =>
  after
    .filter((task) => task.parentId === taskId)
    .map((task) => task.id)
    .filter((taskId) => !before.has(taskId));

export const parseToolInput = <Name extends OdtToolName>(toolName: Name, input: unknown) =>
  Effect.try({
    try: () => ODT_TOOL_SCHEMAS[toolName].parse(input) as OdtToolInput<Name>,
    catch: (cause) =>
      new HostValidationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
        details: {
          operation: `${toolName}.parse_input`,
        },
      }),
  });

export const parseResponse = <Name extends OdtToolName>(toolName: Name, output: unknown) =>
  Effect.try({
    try: () => ODT_HOST_BRIDGE_RESPONSE_SCHEMAS[toolName].parse(output),
    catch: (cause) =>
      new HostValidationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
        details: {
          operation: `${toolName}.parse_response`,
        },
      }),
  });
