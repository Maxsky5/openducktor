import {
  issueTypeSchema,
  qaReportVerdictSchema,
  taskAssetScopeSchema,
  taskStatusSchema,
} from "@openducktor/contracts";
import { sql } from "drizzle-orm";
import {
  blob,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { SqliteDrizzleSession } from "../../infrastructure/sqlite/sqlite-drizzle-client";
import { workspaceSessions } from "./sqlite-workspace-session-schema";
export { workspaceSessions } from "./sqlite-workspace-session-schema";

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

const TASK_WORKFLOW_ARTIFACT_KINDS = ["implementation_plan", "qa_report", "spec"] as const;
export const TASK_WORKFLOW_ARTIFACT_FORMAT_PLAIN_TEXT = "plain_text";
const TASK_WORKFLOW_ARTIFACT_FORMATS = [TASK_WORKFLOW_ARTIFACT_FORMAT_PLAIN_TEXT] as const;
const TASK_QA_REPORT_VERDICTS = nonEmptyEnumOptions(
  qaReportVerdictSchema.options,
  "qaReportVerdictSchema",
);
const TASK_ASSET_SCOPES = nonEmptyEnumOptions(taskAssetScopeSchema.options, "taskAssetScopeSchema");

const enumCheckValues = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", "));

export type WorkflowArtifactKind = (typeof TASK_WORKFLOW_ARTIFACT_KINDS)[number];

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
    sourceProviderId: text("source_provider_id"),
    sourceScope: text("source_scope"),
    sourceId: text("source_id"),
    sourceNumber: text("source_number"),
    sourceUrl: text("source_url"),
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
    uniqueIndex("idx_tasks_source_identity").on(
      table.sourceProviderId,
      table.sourceScope,
      table.sourceId,
    ),
  ],
);

export const taskArtifacts = sqliteTable(
  "tasks_artifacts",
  {
    artifactId: text("artifact_id").notNull(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    classification: text("classification", { enum: ["workflow", "free"] }).notNull(),
    workflowKind: text("workflow_kind", { enum: TASK_WORKFLOW_ARTIFACT_KINDS }),
    code: text("code"),
    revision: integer("revision").notNull(),
    name: text("name").notNull(),
    markdown: text("markdown"),
    format: text("format", { enum: TASK_WORKFLOW_ARTIFACT_FORMATS }),
    verdict: text("verdict", { enum: TASK_QA_REPORT_VERDICTS }),
    sourceTool: text("source_tool"),
    updatedBy: text("updated_by"),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" }),
    content: blob("content", { mode: "buffer" }),
    fileName: text("file_name"),
    mediaType: text("media_type"),
    byteSize: integer("byte_size"),
  },
  (table) => [
    primaryKey({ columns: [table.artifactId, table.revision] }),
    check(
      "chk_tasks_artifacts_variant",
      sql`
      (${table.classification} = 'workflow'
        and ${table.code} is null
        and ${table.workflowKind} is not null
        and ${table.workflowKind} in (${enumCheckValues(TASK_WORKFLOW_ARTIFACT_KINDS)})
        and ${table.artifactId} = 'workflow:' || ${table.taskId} || ':' || ${table.workflowKind}
        and ${table.markdown} is not null
        and ${table.format} is not null
        and ${table.format} in (${enumCheckValues(TASK_WORKFLOW_ARTIFACT_FORMATS)})
        and (${table.verdict} is null or ${table.verdict} in (${enumCheckValues(TASK_QA_REPORT_VERDICTS)}))
        and ${table.content} is null and ${table.fileName} is null
        and ${table.mediaType} is null and ${table.byteSize} is null)
      or (${table.classification} = 'free'
        and ${table.code} is not null and length(${table.code}) between 1 and 128
        and ${table.code} glob '[a-z]*' and ${table.code} not glob '*[^a-z0-9-]*'
        and instr(${table.code}, '--') = 0 and substr(${table.code}, -1) <> '-'
        and ${table.code} not in ('spec', 'plan', 'qaReport')
        and ${table.artifactId} not like 'workflow:%'
        and ${table.workflowKind} is null and ${table.markdown} is null
        and ${table.format} is null and ${table.verdict} is null
        and ${table.sourceTool} is null and ${table.updatedBy} is null
        and ${table.updatedAt} is not null and ${table.revision} >= 1
        and typeof(${table.content}) = 'blob'
        and ${table.fileName} is not null and ${table.mediaType} is not null
        and ${table.byteSize} is not null and ${table.byteSize} between 0 and 10485760
        and length(${table.content}) = ${table.byteSize})
    `,
    ),
    uniqueIndex("idx_tasks_artifacts_workflow_revision")
      .on(table.taskId, table.workflowKind, table.revision)
      .where(sql`${table.classification} = 'workflow'`),
    uniqueIndex("idx_tasks_artifacts_free_identity")
      .on(table.artifactId)
      .where(sql`${table.classification} = 'free'`),
    uniqueIndex("idx_tasks_artifacts_free_code")
      .on(table.taskId, table.code)
      .where(sql`${table.classification} = 'free'`),
    index("idx_tasks_artifacts_task").on(table.taskId),
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
  workspaceSessions,
  taskAssets,
  taskArtifacts,
  tasks,
};

export type TaskRow = typeof tasks.$inferSelect;
export type TaskInsert = typeof tasks.$inferInsert;
export type TaskArtifactRow = typeof taskArtifacts.$inferSelect;
export type TaskArtifactInsert = typeof taskArtifacts.$inferInsert;
export type TaskAssetRow = typeof taskAssets.$inferSelect;
export type TaskAssetInsert = typeof taskAssets.$inferInsert;
export type TaskStoreSession = SqliteDrizzleSession<typeof taskStoreSchema>;
