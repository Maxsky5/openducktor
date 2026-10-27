import {
  type FreeTaskArtifact,
  type McpTaskArtifact,
  type OdtToolName,
  type PublicTask,
  type PublicWorkflowArtifactStates,
  type TaskCard,
  type TaskArtifact,
  type TaskSummary,
  type TaskUpdatePatch,
  type UpdateTaskInput,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { JSONType, z } from "zod";
import { normalizeLabels } from "../../domain/task/task-labels";
import { HostValidationError } from "../../effect/host-errors";
import type { TaskReference, TaskRecord } from "../../ports/task-repository-ports";

type ResponseParser<A> = Pick<z.ZodType<A>, "parse">;

const MAX_TASK_CANDIDATES = 5;

export const normalizeKey = (value: string): string => value.trim().toLowerCase();

export const buildTaskUpdatePatch = (
  current: TaskRecord,
  input: UpdateTaskInput,
): TaskUpdatePatch => {
  const patch: TaskUpdatePatch = {};
  if (input.title !== undefined && input.title !== current.title) {
    patch.title = input.title;
  }
  if (input.description !== undefined && input.description !== (current.description ?? "")) {
    patch.description = input.description;
  }
  if (input.priority !== undefined && input.priority !== current.priority) {
    patch.priority = input.priority;
  }
  if (
    input.labels !== undefined &&
    !labelsEqual(normalizeLabels(input.labels), normalizeLabels(current.labels))
  ) {
    patch.labels = input.labels;
  }
  if (input.issueType !== undefined && input.issueType !== current.issueType) {
    patch.issueType = input.issueType;
  }
  return patch;
};

/** Match IDs before titles. Reject ties at the first matching step. */
export const resolveTaskReference = <Task extends TaskReference>(
  tasks: readonly Task[],
  requestedTaskId: string,
): Task => {
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
  const singleCaseInsensitiveId = singleMatch(caseInsensitiveId);
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
    const singleIdSegment = singleMatch(byIdSegment);
    if (singleIdSegment) {
      return singleIdSegment;
    }
    if (byIdSegment.length > 1) {
      throw ambiguousTaskError(requestedTaskId, byIdSegment);
    }
  }
  const byTitleExact = tasks.filter((task) => normalizeKey(task.title) === requestedLower);
  const singleTitleExact = singleMatch(byTitleExact);
  if (singleTitleExact) {
    return singleTitleExact;
  }
  if (byTitleExact.length > 1) {
    throw ambiguousTaskError(requestedTaskId, byTitleExact);
  }
  if (requestedSlug) {
    const byTitleSlug = tasks.filter((task) => sanitizeSlug(task.title) === requestedSlug);
    const singleTitleSlug = singleMatch(byTitleSlug);
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
  const singleTitleContains = singleMatch(byTitleContains);
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
  throw taskNotFoundError(requestedTaskId, candidates);
};

export const taskNotFoundError = (
  requested: string,
  candidates: readonly TaskReference[] = [],
): HostValidationError<{ taskId: string }> => {
  const hint =
    candidates.length > 0 ? ` Candidate task ids: ${candidates.map(formatTaskRef).join(", ")}` : "";
  return new HostValidationError({
    field: "taskId",
    message: `Task not found: ${requested}.${hint}`,
    details: { taskId: requested },
  });
};

export const mapPublicTask = (task: TaskCard): PublicTask => {
  const publicTask: PublicTask = {
    id: task.id,
    title: task.title,
    description: task.description ?? "",
    status: task.status,
    priority: task.priority,
    issueType: task.issueType,
    labels: task.labels,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
  if (task.targetBranch) {
    publicTask.targetBranch = task.targetBranch;
  }
  return publicTask;
};

export const mapTaskSummary = (task: TaskCard): TaskSummary => ({
  task: { ...mapPublicTask(task), workflowArtifacts: publicWorkflowArtifacts(task) },
});

/** The present state and verdict of each workflow artifact, without storage times. */
export const publicWorkflowArtifacts = (task: TaskCard): PublicWorkflowArtifactStates => {
  const states: PublicWorkflowArtifactStates = {};
  for (const [code, state] of Object.entries(task.artifactSummary)) {
    states[code] =
      state.verdict === undefined
        ? { present: state.present }
        : { present: state.present, verdict: state.verdict };
  }
  return states;
};

export const toMcpTaskArtifact = (artifact: TaskArtifact): McpTaskArtifact => {
  const { artifactId: _artifactId, ...metadata } = artifact;
  return metadata;
};

export const findFreeTaskArtifact = (
  artifacts: readonly TaskArtifact[],
  code: string,
): FreeTaskArtifact | undefined =>
  artifacts.find(
    (artifact): artifact is FreeTaskArtifact =>
      artifact.classification === "free" && artifact.code === code,
  );

export const missingFreeTaskArtifact = (code: string): HostValidationError =>
  new HostValidationError({
    field: "code",
    message: `Free artifact "${code}" was not found. Read the task to get its current artifact codes.`,
  });

export const parseToolInput = <Output>(
  toolName: OdtToolName,
  schema: z.ZodType<Output>,
  input: JSONType,
) =>
  Effect.try({
    try: () => schema.parse(input),
    catch: (cause) =>
      new HostValidationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
        details: {
          operation: `${toolName}.parse_input`,
        },
      }),
  });

export const parseResponse = <A, O>(
  toolName: OdtToolName,
  parser: ResponseParser<A>,
  output: O,
): Effect.Effect<A, HostValidationError<{ operation: string }>> =>
  Effect.try({
    try: () => parser.parse(output),
    catch: (cause) =>
      new HostValidationError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
        details: {
          operation: `${toolName}.parse_response`,
        },
      }),
  });

const labelsEqual = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const sanitizeSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const formatTaskRef = (task: TaskReference): string => `${task.id} (${task.title})`;

const ambiguousTaskError = (
  requested: string,
  matches: readonly TaskReference[],
): HostValidationError<{ taskId: string }> =>
  new HostValidationError({
    field: "taskId",
    message: `Task identifier "${requested}" is ambiguous. Use exact task id. Candidates: ${matches
      .slice(0, MAX_TASK_CANDIDATES)
      .map(formatTaskRef)
      .join(", ")}`,
    details: { taskId: requested },
  });

const singleMatch = <Task extends TaskReference>(matches: readonly Task[]): Task | null => {
  const [match] = matches;
  return matches.length === 1 && match ? match : null;
};
