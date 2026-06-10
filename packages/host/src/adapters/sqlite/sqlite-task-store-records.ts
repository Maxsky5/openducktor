import {
  type AgentSessionRecord,
  agentSessionRecordSchema,
  directMergeRecordSchema,
  gitTargetBranchSchema,
  pullRequestSchema,
  type QaReportVerdict,
  type QaWorkflowVerdict,
  type TaskCard,
  type TaskDocumentSummary,
  type TaskMetadataDocument,
  type TaskMetadataPayload,
  type TaskStatus,
  taskCardSchema,
  taskMetadataPayloadSchema,
  taskPrioritySchema,
  taskStatusSchema,
} from "@openducktor/contracts";
import { errorMessage, HostResourceError, HostValidationError } from "../../effect/host-errors";
import type { SqliteDatabase, SqliteValue } from "../../infrastructure/sqlite/sqlite-driver";
import {
  hasRow,
  isRecord,
  optionalNumber,
  optionalString,
  requireDocumentKind,
  requireNumber,
  requireSqliteBoolean,
  requireString,
  type TaskDocumentKind,
  type TaskDocumentRow,
  type TaskRow,
} from "./sqlite-task-store-support";

const ODT_SET_SPEC_SOURCE_TOOL = "odt_set_spec";
const ODT_SET_PLAN_SOURCE_TOOL = "odt_set_plan";
const ODT_QA_APPROVED_SOURCE_TOOL = "odt_qa_approved";
const ODT_QA_REJECTED_SOURCE_TOOL = "odt_qa_rejected";
const TASK_DOCUMENT_FORMAT_PLAIN_TEXT = "plain_text";

export const normalizeLabels = (labels: string[]): string[] =>
  Array.from(new Set(labels.map((label) => label.trim()).filter(Boolean))).sort();

export const encodeJson = (value: unknown): string => JSON.stringify(value);

const toIso = (value: number | null): string | undefined => {
  if (value === null) {
    return undefined;
  }
  return new Date(value).toISOString();
};

const parseJsonColumn = <A>(
  value: string | null,
  fallback: unknown,
  parse: (value: unknown) => A,
  field: string,
  taskId: string,
): A => {
  try {
    const raw = value === null ? fallback : JSON.parse(value);
    return parse(raw);
  } catch (cause) {
    throw new HostValidationError({
      message: `Invalid SQLite task ${taskId} ${field} JSON: ${errorMessage(cause)}`,
      field,
      cause,
      details: { taskId },
    });
  }
};

const labelsFromRow = (row: TaskRow): string[] =>
  parseJsonColumn(
    row.labels_json,
    [],
    (value) => {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
        throw new Error("expected an array of strings");
      }
      return normalizeLabels(value);
    },
    "labels_json",
    row.id,
  );

export const agentSessionsFromRow = (row: TaskRow): AgentSessionRecord[] =>
  parseJsonColumn(
    row.agent_sessions_json,
    [],
    (value) => agentSessionRecordSchema.array().parse(value),
    "agent_sessions_json",
    row.id,
  ).sort((left, right) => right.startedAt.localeCompare(left.startedAt));

const optionalJsonFromRow = <A>(
  row: TaskRow,
  field: keyof Pick<TaskRow, "direct_merge_json" | "pull_request_json" | "target_branch_json">,
  parse: (value: unknown) => A,
): A | undefined =>
  parseJsonColumn(
    row[field],
    null,
    (value) => (value === null ? undefined : parse(value)),
    field,
    row.id,
  );

export const parseTaskRow = (value: unknown): TaskRow => {
  if (!isRecord(value)) {
    throw new HostValidationError({
      message: "SQLite task row must be an object.",
      details: { value },
    });
  }
  return {
    id: requireString(value, "id"),
    title: requireString(value, "title"),
    description: requireString(value, "description"),
    notes: requireString(value, "notes"),
    status: requireString(value, "status"),
    issue_type: requireString(value, "issue_type"),
    priority: requireNumber(value, "priority"),
    parent_id: optionalString(value, "parent_id"),
    qa_required: requireSqliteBoolean(value, "qa_required"),
    labels_json: requireString(value, "labels_json"),
    agent_sessions_json: requireString(value, "agent_sessions_json"),
    target_branch_json: optionalString(value, "target_branch_json"),
    pull_request_json: optionalString(value, "pull_request_json"),
    direct_merge_json: optionalString(value, "direct_merge_json"),
    created_at_ms: requireNumber(value, "created_at_ms"),
    updated_at_ms: requireNumber(value, "updated_at_ms"),
  };
};

const parseDocumentRow = (value: unknown): TaskDocumentRow => {
  if (!isRecord(value)) {
    throw new HostValidationError({
      message: "SQLite task document row must be an object.",
      details: { value },
    });
  }
  return {
    task_id: requireString(value, "task_id"),
    kind: requireDocumentKind(value.kind),
    revision: requireNumber(value, "revision"),
    markdown: requireString(value, "markdown"),
    format: requireString(value, "format"),
    verdict: optionalString(value, "verdict"),
    source_tool: optionalString(value, "source_tool"),
    updated_by: optionalString(value, "updated_by"),
    updated_at_ms: optionalNumber(value, "updated_at_ms"),
  };
};

export const taskRows = (
  database: SqliteDatabase,
  whereSql: string,
  params: SqliteValue[],
): TaskRow[] =>
  database
    .prepare(
      `select id, title, description, notes, status, issue_type, priority, parent_id, qa_required,
        labels_json, agent_sessions_json, target_branch_json, pull_request_json, direct_merge_json,
        created_at_ms, updated_at_ms
       from tasks ${whereSql}
       order by updated_at_ms desc, id asc`,
    )
    .all(...params)
    .map((row) => parseTaskRow(row));

export const latestDocumentRow = (
  database: SqliteDatabase,
  taskId: string,
  kind: TaskDocumentKind,
): TaskDocumentRow | null => {
  const row = database
    .prepare(
      `select task_id, kind, revision, markdown, format, verdict, source_tool, updated_by, updated_at_ms
       from task_documents
       where task_id = ? and kind = ?
       order by revision desc
       limit 1`,
    )
    .get(taskId, kind);
  return hasRow(row) ? parseDocumentRow(row) : null;
};

const documentPresence = (row: TaskDocumentRow | null) => {
  if (!row || row.markdown.trim().length === 0) {
    return { has: false };
  }
  return {
    has: true,
    updatedAt: toIso(row.updated_at_ms),
  };
};

const qaDocumentPresence = (row: TaskDocumentRow | null) => {
  const has = Boolean(row && row.markdown.trim().length > 0);
  const verdict: QaWorkflowVerdict =
    row?.verdict === "approved" || row?.verdict === "rejected" ? row.verdict : "not_reviewed";
  return {
    has,
    updatedAt: has ? toIso(row?.updated_at_ms ?? null) : undefined,
    verdict,
  };
};

const documentSummary = (database: SqliteDatabase, taskId: string): TaskDocumentSummary => ({
  spec: documentPresence(latestDocumentRow(database, taskId, "spec")),
  plan: documentPresence(latestDocumentRow(database, taskId, "implementation_plan")),
  qaReport: qaDocumentPresence(latestDocumentRow(database, taskId, "qa_report")),
});

const toMetadataDocument = (row: TaskDocumentRow | null): TaskMetadataDocument => ({
  markdown: row?.markdown ?? "",
  updatedAt: toIso(row?.updated_at_ms ?? null),
  revision: row?.revision,
});

const toQaMetadataDocument = (
  row: TaskDocumentRow | null,
): TaskMetadataPayload["qaReport"] | undefined => {
  if (!row) {
    return undefined;
  }
  const verdict: QaWorkflowVerdict =
    row.verdict === "approved" || row.verdict === "rejected" ? row.verdict : "not_reviewed";
  return {
    markdown: row.markdown,
    verdict,
    updatedAt: toIso(row.updated_at_ms),
    revision: row.revision,
  };
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
  return tasks.map((task) => ({
    ...task,
    subtaskIds: [...(subtasksByParent.get(task.id) ?? [])].sort(),
  }));
};

const parseTaskStatus = (taskId: string, value: string): TaskStatus => {
  const parsed = taskStatusSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new HostValidationError({
    message: `Invalid SQLite task status for task ${taskId}: ${JSON.stringify(value)}.`,
    field: "status",
    details: { taskId, value },
  });
};

export const rowToTaskCard = (database: SqliteDatabase, row: TaskRow): TaskCard => {
  const targetBranch = optionalJsonFromRow(row, "target_branch_json", (value) =>
    gitTargetBranchSchema.parse(value),
  );
  const pullRequest = optionalJsonFromRow(row, "pull_request_json", (value) =>
    pullRequestSchema.parse(value),
  );
  return taskCardSchema.parse({
    id: row.id,
    title: row.title,
    description: row.description,
    notes: row.notes,
    status: parseTaskStatus(row.id, row.status),
    priority: taskPrioritySchema.parse(row.priority),
    issueType: row.issue_type,
    aiReviewEnabled: row.qa_required === 1,
    availableActions: [],
    labels: labelsFromRow(row),
    parentId: row.parent_id ?? undefined,
    subtaskIds: [],
    agentSessions: agentSessionsFromRow(row),
    targetBranch,
    pullRequest,
    documentSummary: documentSummary(database, row.id),
    updatedAt: new Date(row.updated_at_ms).toISOString(),
    createdAt: new Date(row.created_at_ms).toISOString(),
  });
};

export const getTaskRow = (database: SqliteDatabase, taskId: string): TaskRow | null => {
  const row = database
    .prepare(
      `select id, title, description, notes, status, issue_type, priority, parent_id, qa_required,
        labels_json, agent_sessions_json, target_branch_json, pull_request_json, direct_merge_json,
        created_at_ms, updated_at_ms
       from tasks
       where id = ?`,
    )
    .get(taskId);
  return hasRow(row) ? parseTaskRow(row) : null;
};

export const requireTaskRow = (
  database: SqliteDatabase,
  taskId: string,
  repoPath: string,
): TaskRow => {
  const row = getTaskRow(database, taskId);
  if (!row) {
    throw new HostResourceError({
      resource: "task",
      operation: "sqliteTaskRepository.getTask",
      message: `Task not found: ${taskId}`,
      details: { taskId, repoPath },
    });
  }
  return row;
};

export const getTaskCard = (database: SqliteDatabase, taskId: string, repoPath: string): TaskCard =>
  rowToTaskCard(database, requireTaskRow(database, taskId, repoPath));

export const taskMetadata = (database: SqliteDatabase, row: TaskRow): TaskMetadataPayload =>
  taskMetadataPayloadSchema.parse({
    spec: toMetadataDocument(latestDocumentRow(database, row.id, "spec")),
    plan: toMetadataDocument(latestDocumentRow(database, row.id, "implementation_plan")),
    targetBranch: optionalJsonFromRow(row, "target_branch_json", (value) =>
      gitTargetBranchSchema.parse(value),
    ),
    qaReport: toQaMetadataDocument(latestDocumentRow(database, row.id, "qa_report")),
    pullRequest: optionalJsonFromRow(row, "pull_request_json", (value) =>
      pullRequestSchema.parse(value),
    ),
    directMerge: optionalJsonFromRow(row, "direct_merge_json", (value) =>
      directMergeRecordSchema.parse(value),
    ),
    agentSessions: agentSessionsFromRow(row),
  });

const sanitizeTaskIdPrefix = (input: string): string => {
  let slug = "";
  let lastDash = false;
  for (const character of input) {
    const lower = character.toLowerCase();
    if (/^[a-z0-9]$/.test(lower)) {
      slug += lower;
      lastDash = false;
      continue;
    }
    if (!lastDash) {
      slug += "-";
      lastDash = true;
    }
  }
  const trimmed = slug.replace(/^-+|-+$/g, "");
  return trimmed.length > 0 ? trimmed : "task";
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const taskIdPrefixForRepoPath = (repoPath: string): string =>
  sanitizeTaskIdPrefix(repoPath.split(/[\\/]/).filter(Boolean).at(-1) ?? "task");

export const nextTaskId = (database: SqliteDatabase, repoPath: string): string => {
  const prefix = taskIdPrefixForRepoPath(repoPath);
  const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`);
  const rows = database.prepare("select id from tasks where id like ?").all(`${prefix}-%`);
  let max = 0;
  for (const row of rows) {
    if (!isRecord(row) || typeof row.id !== "string") {
      continue;
    }
    const match = pattern.exec(row.id);
    if (!match) {
      continue;
    }
    max = Math.max(max, Number.parseInt(match[1] ?? "0", 10));
  }
  let candidate = `${prefix}-${max + 1}`;
  while (hasRow(database.prepare("select id from tasks where id = ?").get(candidate))) {
    max += 1;
    candidate = `${prefix}-${max + 1}`;
  }
  return candidate;
};

const nextDocumentRevision = (
  database: SqliteDatabase,
  taskId: string,
  kind: TaskDocumentKind,
): number => {
  const row = database
    .prepare("select max(revision) as revision from task_documents where task_id = ? and kind = ?")
    .get(taskId, kind);
  if (!isRecord(row) || typeof row.revision !== "number") {
    return 1;
  }
  return row.revision + 1;
};

export const insertDocument = (
  database: SqliteDatabase,
  input: {
    kind: TaskDocumentKind;
    markdown: string;
    sourceTool: string;
    taskId: string;
    updatedAtMs: number;
    updatedBy: string;
    verdict?: QaReportVerdict | undefined;
  },
): TaskMetadataDocument => {
  const revision = nextDocumentRevision(database, input.taskId, input.kind);
  const markdown = input.markdown.trim();
  database
    .prepare(
      `insert into task_documents (
        task_id, kind, revision, markdown, format, verdict, source_tool, updated_by, updated_at_ms
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.taskId,
      input.kind,
      revision,
      markdown,
      TASK_DOCUMENT_FORMAT_PLAIN_TEXT,
      input.verdict ?? null,
      input.sourceTool,
      input.updatedBy,
      input.updatedAtMs,
    );
  return {
    markdown,
    updatedAt: new Date(input.updatedAtMs).toISOString(),
    revision,
  };
};

export const qaReportSourceTool = (verdict: QaReportVerdict): string =>
  verdict === "approved" ? ODT_QA_APPROVED_SOURCE_TOOL : ODT_QA_REJECTED_SOURCE_TOOL;

export const specSourceTool = ODT_SET_SPEC_SOURCE_TOOL;
export const planSourceTool = ODT_SET_PLAN_SOURCE_TOOL;
