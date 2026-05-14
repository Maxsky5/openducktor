import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  type AgentSessionRecord,
  agentSessionRecordSchema,
  type DirectMergeRecord,
  directMergeRecordSchema,
  type GitTargetBranch,
  gitTargetBranchSchema,
  type IssueType,
  issueTypeSchema,
  type PullRequest,
  pullRequestSchema,
  type QaReportVerdict,
  type QaWorkflowVerdict,
  type RepoStoreHealth,
  type TaskCard,
  type TaskCreateInput,
  type TaskDocumentSummary,
  type TaskMetadataDocument,
  type TaskMetadataPayload,
  type TaskStatus,
  type TaskUpdatePatch,
  taskCardSchema,
  taskMetadataPayloadSchema,
  taskPrioritySchema,
  taskStatusSchema,
} from "@openducktor/contracts";
import type { SystemCommandPort } from "../ports/system-command-port";
import type { TaskStorePort } from "../ports/task-store-port";
import {
  type BeadsCliContext,
  type ResolveBeadsCliContextOptions,
  resolveBeadsCliContext,
  type StopSharedDoltServer,
  sharedServerHealthFromContext,
  stopOwnedSharedDoltServer,
} from "./node-beads-store-context";

const METADATA_NAMESPACE = "openducktor";
const BD_COMMAND_TIMEOUT_MS = 30_000;
const DOCUMENT_ENCODING_GZIP_BASE64_V1 = "gzip-base64-v1";
const ODT_SET_SPEC_SOURCE_TOOL = "odt_set_spec";
const ODT_SET_PLAN_SOURCE_TOOL = "odt_set_plan";
const ODT_QA_APPROVED_SOURCE_TOOL = "odt_qa_approved";
const ODT_QA_REJECTED_SOURCE_TOOL = "odt_qa_rejected";
const VALID_ISSUE_TYPES = "task, feature, bug, epic";
const VALID_TASK_STATUSES =
  "open, spec_ready, ready_for_dev, in_progress, blocked, ai_review, human_review, deferred, closed";

type RawDependency = {
  dependencyType: string;
  dependsOnId: string | undefined;
  id: string | undefined;
};

type RawIssue = {
  id: string;
  title: string;
  description: string;
  notes: string;
  status: string;
  priority: number;
  issueType: string;
  labels: string[];
  owner: string | undefined;
  parent: string | undefined;
  dependencies: RawDependency[];
  metadata: unknown;
  updatedAt: string;
  createdAt: string;
};

type RunBdJson = (repoPath: string, args: string[], context?: BeadsCliContext) => Promise<unknown>;
type RunBd = (repoPath: string, args: string[], context?: BeadsCliContext) => Promise<string>;
type ResolveBeadsCliContext = (
  repoPath: string,
  options?: ResolveBeadsCliContextOptions,
) => Promise<BeadsCliContext>;
type ResolveWorkspaceIdForRepoPath = (
  repoPath: string,
) => Promise<string | null | undefined> | string | null | undefined;

type RawBdWherePayload = {
  path?: unknown;
  error?: unknown;
};

export type CreateNodeBeadsTaskStorePortInput = {
  now?: () => Date;
  processEnv?: NodeJS.ProcessEnv;
  runBd?: RunBd;
  runBdJson?: RunBdJson;
  resolveCliContext?: ResolveBeadsCliContext;
  resolveWorkspaceIdForRepoPath?: ResolveWorkspaceIdForRepoPath;
  stopSharedDoltServer?: StopSharedDoltServer;
  systemCommands?: Pick<SystemCommandPort, "requiredCommandError">;
};

export type NodeBeadsTaskStoreShutdownResult = {
  stoppedSharedDoltServers: number;
};

export type NodeBeadsTaskStorePort = TaskStorePort & {
  close(): Promise<NodeBeadsTaskStoreShutdownResult>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const requireStringField = (
  record: Record<string, unknown>,
  field: string,
  context: string,
): string => {
  const value = record[field];
  if (typeof value !== "string") {
    throw new Error(`${context}.${field} must be a string`);
  }
  return value;
};

const stringFieldWithDefault = (
  record: Record<string, unknown>,
  field: string,
  defaultValue: string,
  context: string,
): string => {
  const value = record[field];
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "string") {
    throw new Error(`${context}.${field} must be a string`);
  }
  return value;
};

const optionalStringField = (
  record: Record<string, unknown>,
  field: string,
  context: string,
): string | undefined => {
  const value = record[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${context}.${field} must be a string when present`);
  }
  return value;
};

const optionalNumberField = (
  record: Record<string, unknown>,
  field: string,
  defaultValue: number,
  context: string,
): number => {
  const value = record[field];
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "number") {
    throw new Error(`${context}.${field} must be a number`);
  }
  return value;
};

const stringArrayFieldWithDefault = (
  record: Record<string, unknown>,
  field: string,
  context: string,
): string[] => {
  const value = record[field];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${context}.${field} must be an array`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(`${context}.${field}[${index}] must be a string`);
    }
    return entry;
  });
};

const parseRawDependency = (value: unknown, context: string): RawDependency => {
  if (!isRecord(value)) {
    throw new Error(`${context} must be an object`);
  }

  const dependencyType =
    stringFieldWithDefault(value, "type", "", context) ||
    stringFieldWithDefault(value, "dependency_type", "", context);

  return {
    dependencyType,
    dependsOnId: optionalStringField(value, "depends_on_id", context),
    id: optionalStringField(value, "id", context),
  };
};

const parseRawIssue = (value: unknown): RawIssue => {
  if (!isRecord(value)) {
    throw new Error("bd list task entry must be an object");
  }

  const dependenciesValue = value.dependencies;
  if (dependenciesValue !== undefined && !Array.isArray(dependenciesValue)) {
    throw new Error("task.dependencies must be an array");
  }
  const dependencies = (dependenciesValue ?? []).map((dependency, index) =>
    parseRawDependency(dependency, `dependencies[${index}]`),
  );

  return {
    id: requireStringField(value, "id", "task"),
    title: requireStringField(value, "title", "task"),
    description: stringFieldWithDefault(value, "description", "", "task"),
    notes: stringFieldWithDefault(value, "notes", "", "task"),
    status: requireStringField(value, "status", "task"),
    priority: optionalNumberField(value, "priority", 0, "task"),
    issueType: stringFieldWithDefault(value, "issue_type", "", "task"),
    labels: stringArrayFieldWithDefault(value, "labels", "task"),
    owner: optionalStringField(value, "owner", "task"),
    parent: optionalStringField(value, "parent", "task"),
    dependencies,
    metadata: value.metadata,
    updatedAt: requireStringField(value, "updated_at", "task"),
    createdAt: requireStringField(value, "created_at", "task"),
  };
};

const parseIssueType = (taskId: string, value: string): IssueType => {
  const parsed = issueTypeSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(
    `Invalid Beads issue type for task ${taskId}: received ${JSON.stringify(value)}. Expected one of: ${VALID_ISSUE_TYPES}.`,
  );
};

const parseTaskStatus = (taskId: string, value: string): TaskStatus => {
  const parsed = taskStatusSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(
    `Invalid Beads status for task ${taskId}: received ${JSON.stringify(value)}. Expected one of: ${VALID_TASK_STATUSES}.`,
  );
};

const normalizeLabels = (labels: string[]): string[] =>
  Array.from(new Set(labels.map((label) => label.trim()).filter(Boolean))).sort();

const normalizeTextOption = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const metadataNamespace = (metadata: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(metadata)) {
    return undefined;
  }

  const namespace = metadata[METADATA_NAMESPACE];
  return isRecord(namespace) ? namespace : undefined;
};

const documentsMetadata = (
  namespace: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  const documents = namespace?.documents;
  return isRecord(documents) ? documents : undefined;
};

const decodeMarkdownPayload = (payload: string, encoding: string): string => {
  if (encoding !== DOCUMENT_ENCODING_GZIP_BASE64_V1) {
    throw new Error(`Unsupported document encoding: ${encoding}`);
  }

  return gunzipSync(Buffer.from(payload, "base64")).toString("utf8");
};

const documentDecodeError = (path: string, error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return `Failed to decode ${path}: ${message}`;
};

const unavailableSharedServer = (): RepoStoreHealth["sharedServer"] => ({
  host: null,
  port: null,
  ownershipState: "unavailable",
});

const repoStoreHealth = ({
  category,
  status,
  detail,
  attachmentPath,
  databaseName,
  sharedServer,
}: {
  category: RepoStoreHealth["category"];
  status: RepoStoreHealth["status"];
  detail: string | null;
  attachmentPath: string | null;
  databaseName: string | null;
  sharedServer?: RepoStoreHealth["sharedServer"] | undefined;
}): RepoStoreHealth => ({
  category,
  status,
  isReady: status === "ready",
  detail,
  attachment: {
    path: attachmentPath,
    databaseName,
  },
  sharedServer: sharedServer ?? unavailableSharedServer(),
});

const degradedRepoStoreHealth = (
  detail: string,
  context: BeadsCliContext | null = null,
): RepoStoreHealth =>
  repoStoreHealth({
    category: "attachment_verification_failed",
    status: "degraded",
    detail,
    attachmentPath: context?.beadsDir ?? null,
    databaseName: context?.databaseName ?? null,
    sharedServer: context ? sharedServerHealthFromContext(context) : undefined,
  });

const parseBdWherePayload = (payload: unknown): RawBdWherePayload => {
  if (!isRecord(payload)) {
    throw new Error("bd where payload must be an object");
  }

  return {
    path: payload.path,
    error: payload.error,
  };
};

const repoStoreHealthFromBdWherePayload = (
  payload: unknown,
  context: BeadsCliContext,
): RepoStoreHealth => {
  let wherePayload: RawBdWherePayload;
  try {
    wherePayload = parseBdWherePayload(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return degradedRepoStoreHealth(`Failed to decode bd where payload: ${message}`, context);
  }

  const rawPath = wherePayload.path;
  const rawError = wherePayload.error;
  const path = typeof rawPath === "string" ? rawPath.trim() : null;
  const error = typeof rawError === "string" ? rawError.trim() : null;

  if (path && error) {
    return degradedRepoStoreHealth("bd where --json returned both path and error", context);
  }

  if (path) {
    if (path !== context.beadsDir) {
      return degradedRepoStoreHealth(
        `Beads attachment resolves to ${path}, expected ${context.beadsDir}`,
        context,
      );
    }

    return repoStoreHealth({
      category: "healthy",
      status: "ready",
      detail: "Beads attachment and shared Dolt server are healthy.",
      attachmentPath: context.beadsDir,
      databaseName: context.databaseName,
      sharedServer: sharedServerHealthFromContext(context),
    });
  }

  if (error) {
    return degradedRepoStoreHealth(error, context);
  }

  return degradedRepoStoreHealth(
    "bd where --json returned a payload without path or error",
    context,
  );
};

const pathExists = async (inputPath: string): Promise<boolean> => {
  try {
    await access(inputPath);
    return true;
  } catch {
    return false;
  }
};

const diagnoseRepoStoreWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  resolveCliContext: ResolveBeadsCliContext,
  prepare: boolean,
): Promise<RepoStoreHealth> => {
  let context: BeadsCliContext;
  try {
    context = await resolveCliContext(repoPath, { requireSharedServer: prepare });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return repoStoreHealth({
      category: "check_call_failed",
      status: "blocking",
      detail: `Failed to resolve Beads store context: ${message}`,
      attachmentPath: null,
      databaseName: null,
    });
  }

  if (!(await pathExists(context.beadsDir))) {
    return repoStoreHealth({
      category: "missing_attachment",
      status: "blocking",
      detail: `Beads attachment is missing at ${context.beadsDir}`,
      attachmentPath: context.beadsDir,
      databaseName: context.databaseName,
      sharedServer: sharedServerHealthFromContext(context),
    });
  }

  if (!context.sharedServer) {
    return repoStoreHealth({
      category: "shared_server_unavailable",
      status: "blocking",
      detail: `Shared Dolt server state is missing at ${context.serverStatePath}`,
      attachmentPath: context.beadsDir,
      databaseName: context.databaseName,
      sharedServer: sharedServerHealthFromContext(context),
    });
  }

  try {
    const payload = await runBdJson(repoPath, ["where"], context);
    return repoStoreHealthFromBdWherePayload(payload, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return degradedRepoStoreHealth(message, context);
  }
};

const optionalDocumentRevision = (entry: Record<string, unknown>): number | undefined => {
  const revision = entry.revision;
  return typeof revision === "number" && Number.isInteger(revision) && revision > 0
    ? revision
    : undefined;
};

const readMarkdownDocumentEntry = (
  entry: unknown,
  metadataPath: string,
  index: number,
): TaskMetadataDocument => {
  const path = `${metadataPath}[${index}]`;
  if (!isRecord(entry)) {
    return {
      markdown: "",
      error: `Failed to read ${path}: expected an object`,
    };
  }

  const updatedAt = typeof entry.updatedAt === "string" ? entry.updatedAt : undefined;
  const revision = optionalDocumentRevision(entry);
  const payload = entry.markdown;
  if (typeof payload !== "string") {
    return {
      markdown: "",
      updatedAt,
      revision,
      error: `${path}.markdown must be a string`,
    };
  }

  const encoding = entry.encoding;
  if (encoding === undefined || encoding === null) {
    return { markdown: payload, updatedAt, revision };
  }
  if (typeof encoding !== "string") {
    return {
      markdown: "",
      updatedAt,
      revision,
      error: `${path}.encoding must be a string`,
    };
  }

  try {
    return {
      markdown: decodeMarkdownPayload(payload, encoding),
      updatedAt,
      revision,
    };
  } catch (error) {
    return {
      markdown: "",
      updatedAt,
      revision,
      error: documentDecodeError(path, error),
    };
  }
};

const readLatestMarkdownDocument = (value: unknown, metadataPath: string): TaskMetadataDocument => {
  if (value === undefined) {
    return { markdown: "" };
  }
  if (!Array.isArray(value)) {
    return {
      markdown: "",
      error: `Failed to read ${metadataPath}: expected an array`,
    };
  }
  if (value.length === 0) {
    return { markdown: "" };
  }

  const index = value.length - 1;
  return readMarkdownDocumentEntry(value[index], metadataPath, index);
};

const readLatestQaDocument = (
  value: unknown,
  metadataPath: string,
): TaskMetadataPayload["qaReport"] => {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return {
      markdown: "",
      verdict: "not_reviewed",
      error: `Failed to read ${metadataPath}: expected an array`,
    };
  }
  if (value.length === 0) {
    return undefined;
  }

  const index = value.length - 1;
  const entry = value[index];
  const document = readMarkdownDocumentEntry(entry, metadataPath, index);
  const verdict = isRecord(entry) ? entry.verdict : undefined;
  const parsedVerdict = verdict === "approved" || verdict === "rejected" ? verdict : "not_reviewed";
  const verdictError =
    parsedVerdict === "not_reviewed" && isRecord(entry)
      ? `${metadataPath}[${index}].verdict must be one of approved or rejected`
      : undefined;

  return {
    ...document,
    verdict: parsedVerdict,
    error: document.error ?? verdictError,
  };
};

const documentPresence = (value: unknown): boolean => {
  if (value === undefined) {
    return false;
  }

  if (!Array.isArray(value)) {
    return true;
  }

  const entry = value.at(-1);
  if (entry === undefined) {
    return false;
  }

  if (!isRecord(entry)) {
    return true;
  }

  const payload = entry.markdown;
  if (typeof payload !== "string") {
    return true;
  }

  if ("encoding" in entry) {
    if (typeof entry.encoding !== "string") {
      return true;
    }

    try {
      return decodeMarkdownPayload(payload, entry.encoding).trim().length > 0;
    } catch {
      return true;
    }
  }

  return payload.trim().length > 0;
};

const latestEntry = (value: unknown): Record<string, unknown> | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entry = value.at(-1);
  return isRecord(entry) ? entry : undefined;
};

const latestUpdatedAt = (value: unknown): string | undefined => {
  const entry = latestEntry(value);
  return typeof entry?.updatedAt === "string" ? entry.updatedAt : undefined;
};

const latestQaVerdict = (value: unknown): QaWorkflowVerdict => {
  const entry = latestEntry(value);
  if (entry?.verdict === "approved" || entry?.verdict === "rejected") {
    return entry.verdict;
  }

  return "not_reviewed";
};

const markdownDocumentPresence = (value: unknown) => {
  if (!documentPresence(value)) {
    return { has: false };
  }

  return {
    has: true,
    updatedAt: latestUpdatedAt(value),
  };
};

const qaDocumentPresence = (value: unknown) => {
  const has = documentPresence(value);
  return {
    has,
    updatedAt: has ? latestUpdatedAt(value) : undefined,
    verdict: latestQaVerdict(value),
  };
};

const metadataDocumentSummary = (
  namespace: Record<string, unknown> | undefined,
): TaskDocumentSummary => {
  const documents = documentsMetadata(namespace);
  return {
    spec: markdownDocumentPresence(documents?.spec),
    plan: markdownDocumentPresence(documents?.implementationPlan),
    qaReport: qaDocumentPresence(documents?.qaReports),
  };
};

const parseTargetBranchMetadata = (
  namespace: Record<string, unknown> | undefined,
): { targetBranch?: GitTargetBranch; targetBranchError?: string } => {
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

const parsePullRequestMetadata = (
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

const parseDirectMergeMetadata = (
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

const parseAgentSessionsMetadata = (
  taskId: string,
  namespace: Record<string, unknown> | undefined,
): AgentSessionRecord[] => {
  if (!namespace || !("agentSessions" in namespace)) {
    return [];
  }

  const parsed = agentSessionRecordSchema.array().safeParse(namespace.agentSessions);
  if (!parsed.success) {
    throw new Error(
      `Invalid openducktor.agentSessions metadata for issue ${taskId}: ${parsed.error.message}. Fix the saved task metadata and retry.`,
    );
  }

  return [...parsed.data].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
};

const parseParentId = (issue: RawIssue): string | undefined => {
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

const parseTaskCard = (issue: RawIssue): TaskCard => {
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

const parseTaskMetadata = (issue: RawIssue): TaskMetadataPayload => {
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

const rawIssueFromCreatePayload = (value: unknown): RawIssue => {
  try {
    return parseRawIssue(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to decode created issue: ${message}`);
  }
};

const showRawIssue = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
): Promise<RawIssue> => {
  const value = await runBdJson(repoPath, ["show", "--id", taskId]);
  const issueValue = Array.isArray(value) ? value[0] : undefined;
  if (issueValue === undefined) {
    throw new Error(`Task not found: ${taskId}`);
  }

  try {
    return parseRawIssue(issueValue);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to decode bd show payload: ${message}`);
  }
};

const appendRawIssueList = (value: unknown, seenTaskIds: Set<string>, tasks: TaskCard[]): void => {
  if (!Array.isArray(value)) {
    throw new Error("bd list did not return an array");
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

const finalizeTaskCards = (tasks: TaskCard[]): TaskCard[] => {
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

const cutoffDate = (now: Date, doneVisibleDays: number): string => {
  const cutoff = new Date(now.getTime() - doneVisibleDays * 24 * 60 * 60 * 1000);
  if (Number.isNaN(cutoff.getTime())) {
    throw new Error("doneVisibleDays causes datetime underflow");
  }

  return cutoff.toISOString().slice(0, 10);
};

const metadataRoot = (metadata: unknown): Record<string, unknown> =>
  isRecord(metadata) ? { ...metadata } : {};

const namespaceMap = (root: Record<string, unknown>): Record<string, unknown> => {
  const namespace = root[METADATA_NAMESPACE];
  return isRecord(namespace) ? { ...namespace } : {};
};

const writeMetadata = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
  metadata: Record<string, unknown>,
): Promise<void> => {
  await runBdJson(repoPath, ["update", "--metadata", JSON.stringify(metadata), "--", taskId]);
};

const loadNamespace = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
): Promise<{
  root: Record<string, unknown>;
  namespace: Record<string, unknown>;
}> => {
  const issue = await showRawIssue(runBdJson, repoPath, taskId);
  const root = metadataRoot(issue.metadata);
  return {
    root,
    namespace: namespaceMap(root),
  };
};

const nextDocumentRevision = (value: unknown, metadataPath: string): number => {
  if (value === undefined) {
    return 1;
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid existing ${metadataPath} metadata: expected an array`);
  }

  let maxRevision = 0;
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      throw new Error(
        `Invalid existing ${metadataPath} metadata at index ${index}: expected an object`,
      );
    }
    const revision = entry.revision;
    if (revision === undefined) {
      continue;
    }
    if (typeof revision !== "number" || !Number.isInteger(revision) || revision <= 0) {
      throw new Error(
        `Invalid existing ${metadataPath} metadata at index ${index}: revision must be a positive integer`,
      );
    }
    maxRevision = Math.max(maxRevision, revision);
  }

  return maxRevision + 1;
};

const writeDocumentWithBd = async (
  runBdJson: RunBdJson,
  now: () => Date,
  repoPath: string,
  taskId: string,
  markdown: string,
  documentKey: "spec" | "implementationPlan",
): Promise<TaskMetadataDocument> => {
  const trimmed = markdown.trim();
  const { root, namespace } = await loadNamespace(runBdJson, repoPath, taskId);
  const documentsPath = `${METADATA_NAMESPACE}.documents.${documentKey}`;
  const documents = documentsMetadata(namespace) ? { ...documentsMetadata(namespace) } : {};
  const revision = nextDocumentRevision(documents[documentKey], documentsPath);
  const updatedAt = now().toISOString();
  const sourceTool = documentKey === "spec" ? ODT_SET_SPEC_SOURCE_TOOL : ODT_SET_PLAN_SOURCE_TOOL;

  documents[documentKey] = [
    {
      markdown: gzipSync(trimmed).toString("base64"),
      encoding: DOCUMENT_ENCODING_GZIP_BASE64_V1,
      updatedAt,
      updatedBy: "planner-agent",
      sourceTool,
      revision,
    },
  ];
  namespace.documents = documents;
  root[METADATA_NAMESPACE] = namespace;
  await writeMetadata(runBdJson, repoPath, taskId, root);

  return {
    markdown: trimmed,
    updatedAt,
    revision,
  };
};

const qaReportSourceTool = (verdict: QaReportVerdict): string =>
  verdict === "approved" ? ODT_QA_APPROVED_SOURCE_TOOL : ODT_QA_REJECTED_SOURCE_TOOL;

const writeLatestQaReport = (
  now: () => Date,
  documents: Record<string, unknown>,
  markdown: string,
  verdict: QaReportVerdict,
): void => {
  const documentsPath = `${METADATA_NAMESPACE}.documents.qaReports`;
  const revision = nextDocumentRevision(documents.qaReports, documentsPath);
  const trimmed = markdown.trim();

  documents.qaReports = [
    {
      markdown: gzipSync(trimmed).toString("base64"),
      encoding: DOCUMENT_ENCODING_GZIP_BASE64_V1,
      verdict,
      updatedAt: now().toISOString(),
      updatedBy: "qa-agent",
      sourceTool: qaReportSourceTool(verdict),
      revision,
    },
  ];
};

const recordQaOutcomeWithBd = async (
  runBdJson: RunBdJson,
  now: () => Date,
  repoPath: string,
  taskId: string,
  status: TaskStatus,
  markdown: string,
  verdict: QaReportVerdict,
): Promise<TaskCard> => {
  const { root, namespace } = await loadNamespace(runBdJson, repoPath, taskId);
  const documents = documentsMetadata(namespace) ? { ...documentsMetadata(namespace) } : {};
  writeLatestQaReport(now, documents, markdown, verdict);
  namespace.documents = documents;
  root[METADATA_NAMESPACE] = namespace;

  await runBdJson(repoPath, [
    "update",
    "--status",
    status,
    "--metadata",
    JSON.stringify(root),
    "--",
    taskId,
  ]);

  return parseTaskCard(await showRawIssue(runBdJson, repoPath, taskId));
};

const compactAgentSessionForStorage = (session: AgentSessionRecord): AgentSessionRecord => {
  const role = session.role.trim();
  if (!role) {
    throw new Error("Agent session role is required");
  }

  const externalSessionId = session.externalSessionId.trim();
  if (!externalSessionId) {
    throw new Error("Agent session externalSessionId is required");
  }

  const startedAt = session.startedAt.trim();
  if (!startedAt) {
    throw new Error("Agent session startedAt is required");
  }

  const runtimeKind = session.runtimeKind.trim();
  if (!runtimeKind) {
    throw new Error("Agent session runtimeKind is required");
  }

  const workingDirectory = session.workingDirectory.trim();
  if (!workingDirectory) {
    throw new Error("Agent session workingDirectory is required");
  }

  const selectedModel =
    session.selectedModel === null
      ? null
      : {
          ...session.selectedModel,
          runtimeKind: session.selectedModel.runtimeKind.trim(),
        };
  if (selectedModel !== null && !selectedModel.runtimeKind) {
    throw new Error("Agent session selectedModel.runtimeKind is required");
  }

  return agentSessionRecordSchema.parse({
    ...session,
    externalSessionId,
    role,
    startedAt,
    runtimeKind,
    workingDirectory,
    selectedModel,
  });
};

const upsertAgentSessionWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
  session: AgentSessionRecord,
): Promise<boolean> => {
  const compactSession = compactAgentSessionForStorage(session);
  const { root, namespace } = await loadNamespace(runBdJson, repoPath, taskId);
  const sessions = parseAgentSessionsMetadata(taskId, namespace);
  const existingIndex = sessions.findIndex(
    (entry) => entry.externalSessionId === compactSession.externalSessionId,
  );

  if (existingIndex >= 0) {
    sessions[existingIndex] = compactSession;
  } else {
    sessions.push(compactSession);
  }

  namespace.agentSessions = sessions
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .slice(0, 100);
  root[METADATA_NAMESPACE] = namespace;
  await writeMetadata(runBdJson, repoPath, taskId, root);

  return true;
};

const setPullRequestWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
  pullRequest: PullRequest | null,
): Promise<boolean> => {
  const { root, namespace } = await loadNamespace(runBdJson, repoPath, taskId);
  if (pullRequest === null) {
    delete namespace.pullRequest;
  } else {
    namespace.pullRequest = pullRequestSchema.parse(pullRequest);
    delete namespace.directMerge;
  }
  delete namespace.delivery;
  root[METADATA_NAMESPACE] = namespace;
  await writeMetadata(runBdJson, repoPath, taskId, root);

  return true;
};

const setDirectMergeWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
  directMerge: DirectMergeRecord | null,
): Promise<boolean> => {
  const { root, namespace } = await loadNamespace(runBdJson, repoPath, taskId);
  if (directMerge === null) {
    delete namespace.directMerge;
  } else {
    namespace.directMerge = directMergeRecordSchema.parse(directMerge);
    delete namespace.pullRequest;
  }
  delete namespace.delivery;
  root[METADATA_NAMESPACE] = namespace;
  await writeMetadata(runBdJson, repoPath, taskId, root);

  return true;
};

const clearAgentSessionsByRolesWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
  roles: string[],
): Promise<boolean> => {
  const roleSet = new Set(roles.map((role) => role.trim()).filter(Boolean));
  if (roleSet.size === 0) {
    return true;
  }

  const { root, namespace } = await loadNamespace(runBdJson, repoPath, taskId);
  const sessions = parseAgentSessionsMetadata(taskId, namespace);
  const remainingSessions = sessions.filter((session) => !roleSet.has(session.role.trim()));
  if (remainingSessions.length === 0) {
    delete namespace.agentSessions;
  } else {
    namespace.agentSessions = remainingSessions;
  }

  root[METADATA_NAMESPACE] = namespace;
  await writeMetadata(runBdJson, repoPath, taskId, root);

  return true;
};

const clearWorkflowDocumentsWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
): Promise<boolean> => {
  const { root, namespace } = await loadNamespace(runBdJson, repoPath, taskId);
  const documents = isRecord(namespace.documents) ? { ...namespace.documents } : undefined;
  if (!documents) {
    return true;
  }

  delete documents.spec;
  delete documents.implementationPlan;
  delete documents.qaReports;
  if (Object.keys(documents).length === 0) {
    delete namespace.documents;
  } else {
    namespace.documents = documents;
  }

  root[METADATA_NAMESPACE] = namespace;
  await writeMetadata(runBdJson, repoPath, taskId, root);

  return true;
};

const clearQaReportsWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
): Promise<boolean> => {
  const { root, namespace } = await loadNamespace(runBdJson, repoPath, taskId);
  const documents = isRecord(namespace.documents) ? { ...namespace.documents } : undefined;
  if (!documents) {
    return true;
  }

  delete documents.qaReports;
  if (Object.keys(documents).length === 0) {
    delete namespace.documents;
  } else {
    namespace.documents = documents;
  }

  root[METADATA_NAMESPACE] = namespace;
  await writeMetadata(runBdJson, repoPath, taskId, root);

  return true;
};

const createTaskWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  input: TaskCreateInput,
): Promise<TaskCard> => {
  const args = [
    "create",
    input.title,
    "--type",
    input.issueType,
    "--priority",
    input.priority.toString(),
  ];
  const description = normalizeTextOption(input.description);
  if (description !== undefined) {
    args.push("--description", description);
  }

  const labels = normalizeLabels(input.labels ?? []);
  if (labels.length > 0) {
    args.push("--labels", labels.join(","));
  }

  const parentId = normalizeTextOption(input.parentId);
  if (parentId !== undefined) {
    args.push("--parent", parentId);
  }

  const createdIssue = rawIssueFromCreatePayload(await runBdJson(repoPath, args));
  const root = metadataRoot(createdIssue.metadata);
  const namespace = namespaceMap(root);
  namespace.qaRequired = input.aiReviewEnabled;
  root[METADATA_NAMESPACE] = namespace;
  await writeMetadata(runBdJson, repoPath, createdIssue.id, root);

  return parseTaskCard(await showRawIssue(runBdJson, repoPath, createdIssue.id));
};

const appendLabelUpdateArgs = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
  labels: string[],
  args: string[],
): Promise<TaskCard | undefined> => {
  const normalizedLabels = normalizeLabels(labels);
  if (normalizedLabels.length > 0) {
    args.push("--set-labels", normalizedLabels.join(","));
    return undefined;
  }

  const currentTask = parseTaskCard(await showRawIssue(runBdJson, repoPath, taskId));
  if (currentTask.labels.length === 0) {
    return currentTask;
  }

  for (const label of currentTask.labels) {
    args.push("--remove-label", label);
  }

  return undefined;
};

const updateMetadata = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
  patch: TaskUpdatePatch,
): Promise<void> => {
  const { root, namespace } = await loadNamespace(runBdJson, repoPath, taskId);
  if (patch.aiReviewEnabled !== undefined) {
    namespace.qaRequired = patch.aiReviewEnabled;
  }
  if (patch.targetBranch !== undefined) {
    namespace.targetBranch = patch.targetBranch;
  }
  root[METADATA_NAMESPACE] = namespace;
  await writeMetadata(runBdJson, repoPath, taskId, root);
};

const updateTaskWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
  patch: TaskUpdatePatch,
): Promise<TaskCard> => {
  const args = ["update"];
  const updatesMetadata = patch.aiReviewEnabled !== undefined || patch.targetBranch !== undefined;
  let currentTaskAfterNoopLabelUpdate: TaskCard | undefined;

  if (patch.title !== undefined) {
    args.push("--title", patch.title);
  }
  if (patch.description !== undefined) {
    args.push("--description", patch.description);
  }
  if (patch.notes !== undefined) {
    args.push("--notes", patch.notes);
  }
  if (patch.priority !== undefined) {
    args.push("--priority", patch.priority.toString());
  }
  if (patch.issueType !== undefined) {
    args.push("--type", patch.issueType);
  }
  if (patch.assignee !== undefined) {
    args.push("--assignee", patch.assignee);
  }
  if (patch.parentId !== undefined) {
    args.push("--parent", patch.parentId.trim());
  }
  if (patch.labels !== undefined) {
    currentTaskAfterNoopLabelUpdate = await appendLabelUpdateArgs(
      runBdJson,
      repoPath,
      taskId,
      patch.labels,
      args,
    );
  }

  if (args.length > 1) {
    await runBdJson(repoPath, [...args, "--", taskId]);
  }

  if (updatesMetadata) {
    await updateMetadata(runBdJson, repoPath, taskId, patch);
  }

  if (currentTaskAfterNoopLabelUpdate && args.length === 1 && !updatesMetadata) {
    return currentTaskAfterNoopLabelUpdate;
  }

  return parseTaskCard(await showRawIssue(runBdJson, repoPath, taskId));
};

const transitionTaskWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
  status: TaskStatus,
): Promise<TaskCard> => {
  await runBdJson(repoPath, ["update", "--status", status, "--", taskId]);
  return parseTaskCard(await showRawIssue(runBdJson, repoPath, taskId));
};

const getTaskWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
): Promise<TaskCard> => parseTaskCard(await showRawIssue(runBdJson, repoPath, taskId));

const getTaskMetadataWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
): Promise<TaskMetadataPayload> =>
  parseTaskMetadata(await showRawIssue(runBdJson, repoPath, taskId));

const listTasksWithBd = async (
  runBdJson: RunBdJson,
  now: () => Date,
  repoPath: string,
  doneVisibleDays: number | undefined,
): Promise<TaskCard[]> => {
  const tasks: TaskCard[] = [];
  const seenTaskIds = new Set<string>();

  if (doneVisibleDays === undefined) {
    appendRawIssueList(
      await runBdJson(repoPath, ["list", "--all", "--limit", "0"]),
      seenTaskIds,
      tasks,
    );
    return finalizeTaskCards(tasks);
  }

  appendRawIssueList(await runBdJson(repoPath, ["list", "--limit", "0"]), seenTaskIds, tasks);

  if (doneVisibleDays > 0) {
    appendRawIssueList(
      await runBdJson(repoPath, [
        "list",
        "--status",
        "closed",
        "--closed-after",
        cutoffDate(now(), doneVisibleDays),
        "--limit",
        "0",
      ]),
      seenTaskIds,
      tasks,
    );
  }

  return finalizeTaskCards(tasks);
};

const isPullRequestSyncCandidate = (task: TaskCard): boolean =>
  task.status !== "closed" &&
  task.status !== "deferred" &&
  (task.pullRequest?.state === "open" || task.pullRequest?.state === "draft");

const listPullRequestSyncCandidatesWithBd = async (
  runBdJson: RunBdJson,
  now: () => Date,
  repoPath: string,
): Promise<TaskCard[]> =>
  (await listTasksWithBd(runBdJson, now, repoPath, undefined)).filter(isPullRequestSyncCandidate);

const deleteTaskWithBd = async (
  runBd: RunBd,
  repoPath: string,
  taskId: string,
  deleteSubtasks: boolean,
): Promise<boolean> => {
  const args = ["delete", "--force"];
  if (deleteSubtasks) {
    args.push("--cascade");
  }
  args.push("--", taskId);

  await runBd(repoPath, args);
  return true;
};

const argsWithJson = (args: string[]): string[] => {
  const delimiterIndex = args.indexOf("--");
  if (delimiterIndex >= 0) {
    return [...args.slice(0, delimiterIndex), "--json", "--", ...args.slice(delimiterIndex + 1)];
  }

  return [...args, "--json"];
};

const spawnBd = (
  repoPath: string,
  args: string[],
  onSuccess: (stdout: string) => unknown,
  context?: BeadsCliContext,
  resolveCliContext: ResolveBeadsCliContext = resolveBeadsCliContext,
): Promise<unknown> =>
  (async () => {
    const cliContext =
      context ?? (await resolveCliContext(repoPath, { requireSharedServer: true }));

    return new Promise((resolve, reject) => {
      const command = args[0] ?? "unknown";
      const child = spawn("bd", args, {
        cwd: cliContext.workingDir,
        env: cliContext.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill("SIGTERM");
        reject(new Error(`Timed out running bd ${command} after ${BD_COMMAND_TIMEOUT_MS}ms`));
      }, BD_COMMAND_TIMEOUT_MS);

      child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
      child.once("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        const stdout = Buffer.concat(stdoutChunks).toString("utf8");
        const stderr = Buffer.concat(stderrChunks).toString("utf8");

        if (code !== 0) {
          const output = stderr.trim() || stdout.trim() || "no output";
          reject(new Error(`bd ${command} failed with code ${code}: ${output}`));
          return;
        }

        try {
          resolve(onSuccess(stdout));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          reject(new Error(`Failed to parse bd JSON output from \`bd ${command}\`: ${message}`));
        }
      });
    });
  })();

const defaultRunBd =
  (resolveCliContext: ResolveBeadsCliContext): RunBd =>
  (repoPath, args, context) =>
    spawnBd(repoPath, args, (stdout) => stdout, context, resolveCliContext) as Promise<string>;

const defaultRunBdJson =
  (resolveCliContext: ResolveBeadsCliContext): RunBdJson =>
  (repoPath, args, context) =>
    spawnBd(
      repoPath,
      argsWithJson(args),
      (stdout) => JSON.parse(stdout),
      context,
      resolveCliContext,
    );

export const createNodeBeadsTaskStorePort = ({
  now = () => new Date(),
  processEnv = process.env,
  runBd,
  runBdJson,
  resolveCliContext = resolveBeadsCliContext,
  resolveWorkspaceIdForRepoPath,
  stopSharedDoltServer = stopOwnedSharedDoltServer,
  systemCommands,
}: CreateNodeBeadsTaskStorePortInput = {}): NodeBeadsTaskStorePort => {
  const ownedSharedDoltServers = new Map<string, BeadsCliContext["sharedServer"]>();
  const cliContextFlights = new Set<Promise<BeadsCliContext>>();
  let closing = false;

  const assertRequiredCommand = async (command: string): Promise<void> => {
    if (!systemCommands) {
      return;
    }

    const error = await systemCommands.requiredCommandError(command);
    if (error !== null) {
      throw new Error(error);
    }
  };

  const resolveEffectiveCliContext: ResolveBeadsCliContext = async (repoPath, options = {}) => {
    if (closing) {
      throw new Error("Beads task store is closing.");
    }
    const configuredWorkspaceId =
      typeof options.workspaceId === "string" && options.workspaceId.trim().length > 0
        ? options.workspaceId.trim()
        : null;
    const cliOptions = { ...options, processEnv };
    await assertRequiredCommand("bd");
    if (cliOptions.requireSharedServer === true) {
      await assertRequiredCommand("dolt");
    }
    if (closing) {
      throw new Error("Beads task store is closing.");
    }

    const trackOwnedSharedServer = (context: BeadsCliContext): BeadsCliContext => {
      if (context.sharedServer?.ownerPid === process.pid) {
        ownedSharedDoltServers.set(context.serverStatePath, context.sharedServer);
      }
      return context;
    };

    const trackCliContextResolution = (
      contextPromise: Promise<BeadsCliContext>,
    ): Promise<BeadsCliContext> => {
      const flight = contextPromise.then(trackOwnedSharedServer);
      cliContextFlights.add(flight);
      return flight.finally(() => {
        cliContextFlights.delete(flight);
      });
    };

    if (configuredWorkspaceId || !resolveWorkspaceIdForRepoPath) {
      return trackCliContextResolution(resolveCliContext(repoPath, cliOptions));
    }

    const workspaceId = await resolveWorkspaceIdForRepoPath(repoPath);
    if (closing) {
      throw new Error("Beads task store is closing.");
    }
    const normalizedWorkspaceId =
      typeof workspaceId === "string" && workspaceId.trim().length > 0 ? workspaceId.trim() : null;

    return trackCliContextResolution(
      resolveCliContext(
        repoPath,
        normalizedWorkspaceId ? { ...cliOptions, workspaceId: normalizedWorkspaceId } : cliOptions,
      ),
    );
  };
  const effectiveRunBd = runBd ?? defaultRunBd(resolveEffectiveCliContext);
  const effectiveRunBdJson = runBdJson ?? defaultRunBdJson(resolveEffectiveCliContext);

  return {
    async close() {
      closing = true;
      await Promise.allSettled([...cliContextFlights]);
      const errors: string[] = [];
      let stoppedSharedDoltServers = 0;
      for (const [serverStatePath, sharedServer] of ownedSharedDoltServers) {
        if (!sharedServer) {
          continue;
        }
        try {
          await stopSharedDoltServer(sharedServer, serverStatePath);
          stoppedSharedDoltServers += 1;
          ownedSharedDoltServers.delete(serverStatePath);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`Failed stopping shared Dolt server ${sharedServer.pid}: ${message}`);
        }
      }
      if (errors.length > 0) {
        throw new Error(errors.join("\n"));
      }
      return { stoppedSharedDoltServers };
    },
    listTasks({ repoPath, doneVisibleDays }) {
      return listTasksWithBd(effectiveRunBdJson, now, repoPath, doneVisibleDays);
    },
    getTask({ repoPath, taskId }) {
      return getTaskWithBd(effectiveRunBdJson, repoPath, taskId);
    },
    getTaskMetadata({ repoPath, taskId }) {
      return getTaskMetadataWithBd(effectiveRunBdJson, repoPath, taskId);
    },
    diagnoseRepoStore({ repoPath, prepare = false }) {
      return diagnoseRepoStoreWithBd(
        effectiveRunBdJson,
        repoPath,
        resolveEffectiveCliContext,
        prepare,
      );
    },
    listPullRequestSyncCandidates({ repoPath }) {
      return listPullRequestSyncCandidatesWithBd(effectiveRunBdJson, now, repoPath);
    },
    setSpecDocument({ repoPath, taskId, markdown }) {
      return writeDocumentWithBd(effectiveRunBdJson, now, repoPath, taskId, markdown, "spec");
    },
    setPlanDocument({ repoPath, taskId, markdown }) {
      return writeDocumentWithBd(
        effectiveRunBdJson,
        now,
        repoPath,
        taskId,
        markdown,
        "implementationPlan",
      );
    },
    recordQaOutcome({ repoPath, taskId, status, markdown, verdict }) {
      return recordQaOutcomeWithBd(
        effectiveRunBdJson,
        now,
        repoPath,
        taskId,
        status,
        markdown,
        verdict,
      );
    },
    upsertAgentSession({ repoPath, taskId, session }) {
      return upsertAgentSessionWithBd(effectiveRunBdJson, repoPath, taskId, session);
    },
    setPullRequest({ repoPath, taskId, pullRequest }) {
      return setPullRequestWithBd(effectiveRunBdJson, repoPath, taskId, pullRequest);
    },
    setDirectMerge({ repoPath, taskId, directMerge }) {
      return setDirectMergeWithBd(effectiveRunBdJson, repoPath, taskId, directMerge);
    },
    clearAgentSessionsByRoles({ repoPath, taskId, roles }) {
      return clearAgentSessionsByRolesWithBd(effectiveRunBdJson, repoPath, taskId, roles);
    },
    clearWorkflowDocuments({ repoPath, taskId }) {
      return clearWorkflowDocumentsWithBd(effectiveRunBdJson, repoPath, taskId);
    },
    clearQaReports({ repoPath, taskId }) {
      return clearQaReportsWithBd(effectiveRunBdJson, repoPath, taskId);
    },
    createTask({ repoPath, task }) {
      return createTaskWithBd(effectiveRunBdJson, repoPath, task);
    },
    updateTask({ repoPath, taskId, patch }) {
      return updateTaskWithBd(effectiveRunBdJson, repoPath, taskId, patch);
    },
    transitionTask({ repoPath, taskId, status }) {
      return transitionTaskWithBd(effectiveRunBdJson, repoPath, taskId, status);
    },
    deleteTask({ repoPath, taskId, deleteSubtasks }) {
      return deleteTaskWithBd(effectiveRunBd, repoPath, taskId, deleteSubtasks);
    },
  };
};
