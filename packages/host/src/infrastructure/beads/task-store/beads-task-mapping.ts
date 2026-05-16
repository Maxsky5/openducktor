import {
  type AgentSessionRecord,
  agentSessionRecordSchema,
  type DirectMergeRecord,
  directMergeRecordSchema,
  type GitTargetBranch,
  gitTargetBranchSchema,
  type PullRequest,
  pullRequestSchema,
  type TaskCard,
  type TaskDocumentSummary,
  type TaskMetadataPayload,
  taskCardSchema,
  taskMetadataPayloadSchema,
  taskPrioritySchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  HostOperationError,
  HostResourceError,
  HostValidationError,
} from "../../../effect/host-errors";
import {
  documentsMetadata,
  markdownDocumentPresence,
  metadataNamespace,
  qaDocumentPresence,
  readLatestMarkdownDocument,
  readLatestQaDocument,
} from "./beads-documents";
import {
  isRecord,
  METADATA_NAMESPACE,
  normalizeLabels,
  parseIssueType,
  parseRawIssue,
  parseTaskStatus,
  type RawIssue,
  type RunBdJson,
} from "./beads-raw-issue";
export const metadataDocumentSummary = (
  namespace: Record<string, unknown> | undefined,
): TaskDocumentSummary => {
  const documents = documentsMetadata(namespace);
  return {
    spec: markdownDocumentPresence(documents?.spec),
    plan: markdownDocumentPresence(documents?.implementationPlan),
    qaReport: qaDocumentPresence(documents?.qaReports),
  };
};
export const parseTargetBranchMetadata = (
  namespace: Record<string, unknown> | undefined,
): {
  targetBranch?: GitTargetBranch;
  targetBranchError?: string;
} => {
  if (!namespace || !("targetBranch" in namespace)) {
    return {};
  }
  const parsed = gitTargetBranchSchema.safeParse(namespace.targetBranch);
  if (parsed.success) {
    return { targetBranch: parsed.data };
  }
  return {
    targetBranchError: `Invalid openducktor.targetBranch metadata: ${parsed.error.message}. Fix the saved task metadata or choose a valid target branch again.`,
  };
};
export const parsePullRequestMetadata = (
  namespace: Record<string, unknown> | undefined,
): PullRequest | undefined => {
  if (!namespace) {
    return undefined;
  }
  const delivery = isRecord(namespace.delivery) ? namespace.delivery : undefined;
  const candidate =
    namespace.pullRequest ?? (delivery?.linkedPullRequest ? delivery.linkedPullRequest : undefined);
  const parsed = pullRequestSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
};
export const parseDirectMergeMetadata = (
  namespace: Record<string, unknown> | undefined,
): DirectMergeRecord | undefined => {
  if (!namespace) {
    return undefined;
  }
  const delivery = isRecord(namespace.delivery) ? namespace.delivery : undefined;
  const candidate =
    namespace.directMerge ?? (delivery?.directMerge ? delivery.directMerge : undefined);
  const parsed = directMergeRecordSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
};
export const parseAgentSessionsMetadata = (
  taskId: string,
  namespace: Record<string, unknown> | undefined,
): AgentSessionRecord[] => {
  if (!namespace || !("agentSessions" in namespace)) {
    return [];
  }
  const parsed = agentSessionRecordSchema.array().safeParse(namespace.agentSessions);
  if (!parsed.success) {
    throw new HostValidationError({
      message: `Invalid openducktor.agentSessions metadata for issue ${taskId}: ${parsed.error.message}. Fix the saved task metadata and retry.`,
      field: "agentSessions",
      details: { taskId },
    });
  }
  return [...parsed.data].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
};
export const parseParentId = (issue: RawIssue): string | undefined => {
  if (issue.parent !== undefined) {
    return issue.parent;
  }
  for (const dependency of issue.dependencies) {
    if (dependency.dependencyType === "parent-child") {
      return dependency.dependsOnId ?? dependency.id;
    }
  }
  return undefined;
};
export const parseTaskCard = (issue: RawIssue): TaskCard => {
  const issueType = parseIssueType(issue.id, issue.issueType);
  const status = parseTaskStatus(issue.id, issue.status);
  const namespace = metadataNamespace(issue.metadata);
  const qaRequired = namespace?.qaRequired;
  const documentSummary = metadataDocumentSummary(namespace);
  const { targetBranch, targetBranchError } = parseTargetBranchMetadata(namespace);
  return taskCardSchema.parse({
    id: issue.id,
    title: issue.title,
    description: issue.description,
    notes: issue.notes,
    status,
    priority: taskPrioritySchema.parse(issue.priority),
    issueType,
    aiReviewEnabled: typeof qaRequired === "boolean" ? qaRequired : true,
    availableActions: [],
    labels: normalizeLabels(issue.labels),
    assignee: issue.owner,
    parentId: parseParentId(issue),
    subtaskIds: [],
    agentSessions: parseAgentSessionsMetadata(issue.id, namespace),
    targetBranch,
    targetBranchError,
    pullRequest: parsePullRequestMetadata(namespace),
    documentSummary,
    updatedAt: issue.updatedAt,
    createdAt: issue.createdAt,
  });
};
export const parseTaskMetadata = (issue: RawIssue): TaskMetadataPayload => {
  const namespace = metadataNamespace(issue.metadata);
  const documents = documentsMetadata(namespace);
  const targetBranch = namespace?.targetBranch;
  const parsedTargetBranch = gitTargetBranchSchema.safeParse(targetBranch);
  return taskMetadataPayloadSchema.parse({
    spec: readLatestMarkdownDocument(documents?.spec, `${METADATA_NAMESPACE}.documents.spec`),
    plan: readLatestMarkdownDocument(
      documents?.implementationPlan,
      `${METADATA_NAMESPACE}.documents.implementationPlan`,
    ),
    targetBranch: parsedTargetBranch.success ? parsedTargetBranch.data : undefined,
    qaReport: readLatestQaDocument(
      documents?.qaReports,
      `${METADATA_NAMESPACE}.documents.qaReports`,
    ),
    pullRequest: parsePullRequestMetadata(namespace),
    directMerge: parseDirectMergeMetadata(namespace),
    agentSessions: parseAgentSessionsMetadata(issue.id, namespace),
  });
};
export const rawIssueFromCreatePayload = (value: unknown): RawIssue => {
  try {
    return parseRawIssue(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HostValidationError({
      message: `Failed to decode created issue: ${message}`,
      cause: error,
    });
  }
};
export const showRawIssue = (runBdJson: RunBdJson, repoPath: string, taskId: string) =>
  Effect.gen(function* () {
    const value = yield* runBdJson(repoPath, ["show", "--id", taskId]);
    const issueValue = Array.isArray(value) ? value[0] : undefined;
    if (issueValue === undefined) {
      throw new HostResourceError({
        resource: "task",
        operation: "beadsTaskMapping.showRawIssue",
        message: `Task not found: ${taskId}`,
        details: { taskId, repoPath },
      });
    }
    try {
      return parseRawIssue(issueValue);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HostValidationError({
        message: `Failed to decode bd show payload: ${message}`,
        cause: error,
        details: { taskId, repoPath },
      });
    }
  });
export const appendRawIssueList = (
  value: unknown,
  seenTaskIds: Set<string>,
  tasks: TaskCard[],
): void => {
  if (!Array.isArray(value)) {
    throw new HostValidationError({
      message: "bd list did not return an array",
      details: { context: "bd list" },
    });
  }
  for (const entry of value) {
    const issue = parseRawIssue(entry);
    if (issue.issueType === "event" || issue.issueType === "gate") {
      continue;
    }
    if (seenTaskIds.has(issue.id)) {
      continue;
    }
    seenTaskIds.add(issue.id);
    tasks.push(parseTaskCard(issue));
  }
};
export const finalizeTaskCards = (tasks: TaskCard[]): TaskCard[] => {
  const subtasksByParent = new Map<string, string[]>();
  for (const task of tasks) {
    if (task.parentId !== undefined) {
      const subtasks = subtasksByParent.get(task.parentId) ?? [];
      subtasks.push(task.id);
      subtasksByParent.set(task.parentId, subtasks);
    }
  }
  return tasks.map((task) => {
    const subtaskIds = subtasksByParent.get(task.id) ?? [];
    return {
      ...task,
      subtaskIds: [...subtaskIds].sort(),
    };
  });
};
export const cutoffDate = (now: Date, doneVisibleDays: number): string => {
  const cutoff = new Date(now.getTime() - doneVisibleDays * 24 * 60 * 60 * 1000);
  if (Number.isNaN(cutoff.getTime())) {
    throw new HostOperationError({
      operation: "beadsTaskMapping.cutoffDate",
      message: "doneVisibleDays causes datetime underflow",
      details: { doneVisibleDays },
    });
  }
  return cutoff.toISOString().slice(0, 10);
};
