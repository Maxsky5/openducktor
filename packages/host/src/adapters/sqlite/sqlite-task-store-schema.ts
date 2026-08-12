import {
  issueTypeSchema,
  qaReportVerdictSchema,
  taskAssetScopeSchema,
  taskStatusSchema,
} from "@openducktor/contracts";
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { SqliteDrizzleSession } from "../../infrastructure/sqlite/sqlite-drizzle-client";

const nonEmptyEnumOptions = <T extends string>(
  options: readonly T[],
  name: string,
): readonly [T, ...T[]] => {
  const first = options[0];
  if (first === undefined) {
    throw new Error(`${name} must define at least one value.`);
  }
  return [first, ...options.slice(1)];
};

const TASK_STATUSES = nonEmptyEnumOptions(taskStatusSchema.options, "taskStatusSchema");

const TASK_ISSUE_TYPES = nonEmptyEnumOptions(issueTypeSchema.options, "issueTypeSchema");

const TASK_DOCUMENT_KINDS = ["implementation_plan", "qa_report", "spec"] as const;
export const TASK_DOCUMENT_FORMAT_PLAIN_TEXT = "plain_text";
const TASK_DOCUMENT_FORMATS = [TASK_DOCUMENT_FORMAT_PLAIN_TEXT] as const;
const TASK_QA_REPORT_VERDICTS = nonEmptyEnumOptions(
  qaReportVerdictSchema.options,
  "qaReportVerdictSchema",
);
const TASK_ASSET_SCOPES = nonEmptyEnumOptions(taskAssetScopeSchema.options, "taskAssetScopeSchema");

const enumCheckValues = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", "));

export type TaskDocumentKind = (typeof TASK_DOCUMENT_KINDS)[number];

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", { enum: TASK_STATUSES }).notNull(),
    issueType: text("issue_type", { enum: TASK_ISSUE_TYPES }).notNull(),
    priority: integer("priority").notNull(),
    parentId: text("parent_id"),
    qaRequired: integer("qa_required").notNull(),
    labelsJson: text("labels_json").notNull(),
    agentSessionsJson: text("agent_sessions_json").notNull(),
    targetBranchJson: text("target_branch_json"),
    pullRequestJson: text("pull_request_json"),
    directMergeJson: text("direct_merge_json"),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check("chk_tasks_status", sql`${table.status} in (${enumCheckValues(TASK_STATUSES)})`),
    check(
      "chk_tasks_issue_type",
      sql`${table.issueType} in (${enumCheckValues(TASK_ISSUE_TYPES)})`,
    ),
    check("chk_tasks_priority", sql`${table.priority} between 0 and 4`),
    check("chk_tasks_qa_required", sql`${table.qaRequired} in (0, 1)`),
    index("idx_tasks_status_updated").on(table.status, table.updatedAt),
    index("idx_tasks_parent_id").on(table.parentId),
  ],
);

export const taskDocuments = sqliteTable(
  "task_documents",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: TASK_DOCUMENT_KINDS }).notNull(),
    revision: integer("revision").notNull(),
    markdown: text("markdown").notNull(),
    format: text("format", { enum: TASK_DOCUMENT_FORMATS }).notNull(),
    verdict: text("verdict", { enum: TASK_QA_REPORT_VERDICTS }),
    sourceTool: text("source_tool"),
    updatedBy: text("updated_by"),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" }),
  },
  (table) => [
    check(
      "chk_task_documents_kind",
      sql`${table.kind} in (${enumCheckValues(TASK_DOCUMENT_KINDS)})`,
    ),
    check(
      "chk_task_documents_format",
      sql`${table.format} in (${enumCheckValues(TASK_DOCUMENT_FORMATS)})`,
    ),
    check(
      "chk_task_documents_verdict",
      sql`${table.verdict} is null or ${table.verdict} in (${enumCheckValues(TASK_QA_REPORT_VERDICTS)})`,
    ),
    primaryKey({ columns: [table.taskId, table.kind, table.revision] }),
    index("idx_task_documents_latest").on(table.taskId, table.kind, table.revision),
  ],
);

export const taskAssets = sqliteTable(
  "task_assets",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    scope: text("scope", { enum: TASK_ASSET_SCOPES }).notNull(),
    originalName: text("original_name").notNull(),
    mediaType: text("media_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check("chk_task_assets_scope", sql`${table.scope} in (${enumCheckValues(TASK_ASSET_SCOPES)})`),
    check("chk_task_assets_byte_size", sql`${table.byteSize} >= 0`),
    index("idx_task_assets_task_scope").on(table.taskId, table.scope),
  ],
);

export const taskStoreSchema = {
  taskAssets,
  taskDocuments,
  tasks,
};

export type TaskRow = typeof tasks.$inferSelect;
export type TaskInsert = typeof tasks.$inferInsert;
export type TaskDocumentRow = typeof taskDocuments.$inferSelect;
export type TaskDocumentInsert = typeof taskDocuments.$inferInsert;
export type TaskAssetRow = typeof taskAssets.$inferSelect;
export type TaskAssetInsert = typeof taskAssets.$inferInsert;
export type TaskStoreSession = SqliteDrizzleSession<typeof taskStoreSchema>;
