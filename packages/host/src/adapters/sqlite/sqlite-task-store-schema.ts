import { taskAssetScopeSchema } from "@openducktor/contracts";
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

export const TASK_WORKFLOW_ARTIFACT_FORMAT_PLAIN_TEXT = "plain_text";
const TASK_WORKFLOW_ARTIFACT_FORMATS = [TASK_WORKFLOW_ARTIFACT_FORMAT_PLAIN_TEXT] as const;
const TASK_ASSET_SCOPES = nonEmptyEnumOptions(taskAssetScopeSchema.options, "taskAssetScopeSchema");

const enumCheckValues = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", "));

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    /** A state of the task workflow. The workflow checks it, so storage needs no list. */
    status: text("status").notNull(),
    /** An issue type of the task workflow. */
    issueType: text("issue_type").notNull(),
    priority: integer("priority").notNull(),
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
    // Null follows the global setting. Migration 0010 adds a column check for 0 and 1.
    removeWorktreeOnClose: integer("remove_worktree_on_close", { mode: "boolean" }),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check("chk_tasks_status", sql`length(trim(${table.status})) > 0`),
    check("chk_tasks_issue_type", sql`length(trim(${table.issueType})) > 0`),
    check("chk_tasks_priority", sql`${table.priority} between 0 and 4`),
    index("idx_tasks_status_updated").on(table.status, table.updatedAt),
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
    /** The artifact code. A workflow row stores the code of the workflow artifact. */
    code: text("code").notNull(),
    revision: integer("revision").notNull(),
    name: text("name").notNull(),
    markdown: text("markdown"),
    format: text("format", { enum: TASK_WORKFLOW_ARTIFACT_FORMATS }),
    /** A verdict of the review artifact. The workflow checks it. */
    verdict: text("verdict"),
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
        and length(trim(${table.code})) > 0
        and ${table.artifactId} = 'workflow:' || ${table.taskId} || ':' || ${table.code}
        and ${table.markdown} is not null
        and ${table.format} is not null
        and ${table.format} in (${enumCheckValues(TASK_WORKFLOW_ARTIFACT_FORMATS)})
        and (${table.verdict} is null or length(trim(${table.verdict})) > 0)
        and ${table.content} is null and ${table.fileName} is null
        and ${table.mediaType} is null and ${table.byteSize} is null)
      or (${table.classification} = 'free'
        and length(${table.code}) between 1 and 128
        and ${table.code} glob '[a-z]*' and ${table.code} not glob '*[^a-z0-9-]*'
        and instr(${table.code}, '--') = 0 and substr(${table.code}, -1) <> '-'
        and ${table.artifactId} not like 'workflow:%'
        and ${table.markdown} is null
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
      .on(table.taskId, table.code, table.revision)
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
