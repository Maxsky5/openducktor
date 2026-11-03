import { taskAssetScopeSchema } from "@openducktor/contracts";
import { sql } from "drizzle-orm";
import {
  blob,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import type { SqliteDrizzleSession } from "../../infrastructure/sqlite/sqlite-drizzle-client";
import type { HostValidationError } from "../../effect/host-errors";
import { hostSettingsSchema, workspaces } from "./sqlite-host-settings-schema";
import { booleanCheck, column } from "./sqlite-schema-sql";
import { workspaceSessions } from "./sqlite-workspace-session-schema";
export { workspaceSessions } from "./sqlite-workspace-session-schema";

export const TASK_WORKFLOW_ARTIFACT_FORMAT_PLAIN_TEXT = "plain_text";
const TASK_WORKFLOW_ARTIFACT_FORMATS = [TASK_WORKFLOW_ARTIFACT_FORMAT_PLAIN_TEXT] as const;
const nonEmptyEnumOptions = <T extends string>(options: readonly T[]): readonly [T, ...T[]] => {
  const first = options[0];
  if (first === undefined) throw new Error("Task asset scopes must define at least one value.");
  return [first, ...options.slice(1)];
};
const TASK_ASSET_SCOPES = nonEmptyEnumOptions(taskAssetScopeSchema.options);

export const tasks = sqliteTable(
  "tasks",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.workspaceId, { onDelete: "cascade" }),
    id: text("id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull(),
    issueType: text("issue_type").notNull(),
    priority: integer("priority").notNull(),
    targetBranch: text("target_branch"),
    targetRemote: text("target_remote"),
    removeWorktreeOnClose: integer("remove_worktree_on_close", { mode: "boolean" }),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    check("chk_tasks_status", sql`length(trim(${column(table.status)})) > 0`),
    check("chk_tasks_issue_type", sql`length(trim(${column(table.issueType)})) > 0`),
    check("chk_tasks_priority", sql`${column(table.priority)} between 0 and 4`),
    check(
      "chk_tasks_remove_worktree",
      sql`${column(table.removeWorktreeOnClose)} is null or ${column(table.removeWorktreeOnClose)} in (0, 1)`,
    ),
    index("idx_tasks_status_updated").on(table.workspaceId, table.status, table.updatedAt),
    // New task IDs are unique across workspaces. Imported duplicates stay, so this is no constraint.
    index("idx_tasks_id").on(table.id),
  ],
);

const taskForeignKey = (table: { workspaceId: AnySQLiteColumn; taskId: AnySQLiteColumn }) =>
  foreignKey({
    columns: [table.workspaceId, table.taskId],
    foreignColumns: [tasks.workspaceId, tasks.id],
  }).onDelete("cascade");
const taskIdentity = () => ({
  workspaceId: text("workspace_id").notNull(),
  taskId: text("task_id").notNull(),
});
const modelFields = () => ({
  modelRuntimeKind: text("model_runtime_kind"),
  modelProviderId: text("model_provider_id"),
  modelId: text("model_id"),
  modelVariant: text("model_variant"),
  modelProfileId: text("model_profile_id"),
  modelSpeed: text("model_speed"),
});

export const taskLabels = sqliteTable(
  "task_labels",
  { ...taskIdentity(), position: integer("position").notNull(), label: text("label").notNull() },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.taskId, table.position] }),
    taskForeignKey(table),
    check("chk_task_labels_position", sql`${column(table.position)} >= 0`),
  ],
);

export const taskSessions = sqliteTable(
  "task_sessions",
  {
    ...taskIdentity(),
    position: integer("position").notNull(),
    externalSessionId: text("external_session_id").notNull(),
    role: text("role").notNull(),
    startedAt: integer("started_at_ms").notNull(),
    lastActivityAt: integer("last_activity_at_ms"),
    runtimeKind: text("runtime_kind").notNull(),
    workingDirectory: text("working_directory").notNull(),
    ...modelFields(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.taskId, table.position] }),
    taskForeignKey(table),
    index("idx_task_sessions_runtime_identity").on(
      table.workspaceId,
      table.runtimeKind,
      table.externalSessionId,
    ),
    check("chk_task_sessions_position", sql`${column(table.position)} >= 0`),
    check(
      "chk_task_sessions_started_at",
      sql`${column(table.startedAt)} between -8640000000000000 and 8640000000000000`,
    ),
    check(
      "chk_task_sessions_activity",
      sql`${column(table.lastActivityAt)} is null or ${column(table.lastActivityAt)} between 0 and 9007199254740991`,
    ),
    check(
      "chk_task_sessions_model",
      sql`(${column(table.modelRuntimeKind)} is null and ${column(table.modelProviderId)} is null and ${column(table.modelId)} is null and ${column(table.modelVariant)} is null and ${column(table.modelProfileId)} is null and ${column(table.modelSpeed)} is null) or (${column(table.modelRuntimeKind)} is not null and ${column(table.modelProviderId)} is not null and ${column(table.modelId)} is not null)`,
    ),
  ],
);

export const taskPullRequests = sqliteTable(
  "task_pull_requests",
  {
    ...taskIdentity(),
    providerId: text("provider_id").notNull(),
    repositoryIdentity: text("repository_identity"),
    number: integer("number").notNull(),
    url: text("url").notNull(),
    state: text("state").notNull(),
    createdAt: integer("created_at_ms").notNull(),
    updatedAt: integer("updated_at_ms").notNull(),
    lastSyncedAt: integer("last_synced_at_ms"),
    mergedAt: integer("merged_at_ms"),
    closedAt: integer("closed_at_ms"),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.taskId] }), taskForeignKey(table)],
);

export const taskDirectMerges = sqliteTable(
  "task_direct_merges",
  {
    ...taskIdentity(),
    method: text("method").notNull(),
    sourceBranch: text("source_branch").notNull(),
    targetBranch: text("target_branch").notNull(),
    targetRemote: text("target_remote"),
    mergedAt: integer("merged_at_ms").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.taskId] }), taskForeignKey(table)],
);

export const taskIssueLinks = sqliteTable(
  "task_issue_links",
  {
    ...taskIdentity(),
    providerId: text("provider_id").notNull(),
    providerScope: text("provider_scope").notNull(),
    externalId: text("external_id").notNull(),
    displayNumber: text("display_number").notNull(),
    url: text("url").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.taskId] }),
    uniqueIndex("idx_task_issue_links_source").on(
      table.workspaceId,
      table.providerId,
      table.providerScope,
      table.externalId,
    ),
    taskForeignKey(table),
  ],
);

export const hostMetadata = sqliteTable(
  "host_metadata",
  {
    singletonId: integer("singleton_id").primaryKey(),
    importComplete: integer("import_complete", { mode: "boolean" }).notNull(),
    catalogRevision: integer("catalog_revision").notNull(),
  },
  (table) => [
    check("chk_host_metadata_singleton", sql`${column(table.singletonId)} = 1`),
    check("chk_host_metadata_import_complete", booleanCheck(table.importComplete)),
    check("chk_host_metadata_catalog_revision", sql`${column(table.catalogRevision)} >= 0`),
  ],
);

export const taskArtifacts = sqliteTable(
  "task_artifacts",
  {
    workspaceId: text("workspace_id").notNull(),
    artifactId: text("artifact_id").notNull(),
    taskId: text("task_id").notNull(),
    classification: text("classification", { enum: ["workflow", "free"] }).notNull(),
    /** The artifact code. A workflow row stores the code of the workflow artifact. */
    code: text("code").notNull(),
    revision: integer("revision").notNull(),
    name: text("name").notNull(),
    format: text("format", { enum: TASK_WORKFLOW_ARTIFACT_FORMATS }),
    /** A verdict of the review artifact. The workflow checks it. */
    verdict: text("verdict"),
    sourceTool: text("source_tool"),
    updatedBy: text("updated_by"),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" }),
    fileName: text("file_name"),
    mediaType: text("media_type"),
    byteSize: integer("byte_size"),
    // Large values stay last. SQLite reads a column after a large value through its overflow pages.
    markdown: text("markdown"),
    content: blob("content", { mode: "buffer" }),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.artifactId, table.revision] }),
    taskForeignKey(table),
    check(
      "chk_task_artifacts_variant",
      sql`
      (${column(table.classification)} = 'workflow'
        and length(trim(${column(table.code)})) > 0
        and ${column(table.artifactId)} = 'workflow:' || ${column(table.taskId)} || ':' || ${column(table.code)}
        and ${column(table.markdown)} is not null
        and ${column(table.format)} is not null
        and (${column(table.verdict)} is null or length(trim(${column(table.verdict)})) > 0)
        and ${column(table.content)} is null and ${column(table.fileName)} is null
        and ${column(table.mediaType)} is null and ${column(table.byteSize)} is null)
      or (${column(table.classification)} = 'free'
        and length(${column(table.code)}) between 1 and 128
        and ${column(table.code)} glob '[a-z]*' and ${column(table.code)} not glob '*[^a-z0-9-]*'
        and instr(${column(table.code)}, '--') = 0 and substr(${column(table.code)}, -1) <> '-'
        and ${column(table.artifactId)} not like 'workflow:%'
        and ${column(table.markdown)} is null
        and ${column(table.format)} is null and ${column(table.verdict)} is null
        and ${column(table.sourceTool)} is null and ${column(table.updatedBy)} is null
        and ${column(table.updatedAt)} is not null and ${column(table.revision)} >= 1
        and typeof(${column(table.content)}) = 'blob'
        and ${column(table.fileName)} is not null and ${column(table.mediaType)} is not null
        and ${column(table.byteSize)} is not null and ${column(table.byteSize)} between 0 and 10485760
        and length(${column(table.content)}) = ${column(table.byteSize)})
    `,
    ),
    uniqueIndex("idx_task_artifacts_workflow_revision")
      .on(table.workspaceId, table.taskId, table.code, table.revision)
      .where(sql`${column(table.classification)} = 'workflow'`),
    uniqueIndex("idx_task_artifacts_free_identity")
      .on(table.workspaceId, table.artifactId)
      .where(sql`${column(table.classification)} = 'free'`),
    uniqueIndex("idx_task_artifacts_free_code")
      .on(table.workspaceId, table.taskId, table.code)
      .where(sql`${column(table.classification)} = 'free'`),
    index("idx_task_artifacts_task").on(table.workspaceId, table.taskId),
  ],
);

export const taskAssets = sqliteTable(
  "task_assets",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    taskId: text("task_id").notNull(),
    scope: text("scope", { enum: TASK_ASSET_SCOPES }).notNull(),
    originalName: text("original_name").notNull(),
    mediaType: text("media_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    taskForeignKey(table),
    check("chk_task_assets_byte_size", sql`${column(table.byteSize)} >= 0`),
    index("idx_task_assets_task_scope").on(table.workspaceId, table.taskId, table.scope),
  ],
);

export const hostDatabaseSchema = {
  ...hostSettingsSchema,
  hostMetadata,
  workspaceSessions,
  tasks,
  taskLabels,
  taskSessions,
  taskPullRequests,
  taskDirectMerges,
  taskIssueLinks,
  taskArtifacts,
  taskAssets,
};
export type TaskRow = typeof tasks.$inferSelect;
export type TaskInsert = typeof tasks.$inferInsert;
export type TaskArtifactRow = typeof taskArtifacts.$inferSelect;
export type TaskArtifactInsert = typeof taskArtifacts.$inferInsert;
export type TaskAssetRow = typeof taskAssets.$inferSelect;
export type TaskAssetInsert = typeof taskAssets.$inferInsert;
export type TaskSessionRow = typeof taskSessions.$inferSelect;
/** A task repository session checks its workspace scope again when a transaction starts. */
export type HostDatabaseSession = SqliteDrizzleSession<
  typeof hostDatabaseSchema,
  HostValidationError
>;
