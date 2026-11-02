import { taskAssetScopeSchema } from "@openducktor/contracts";
import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { SqliteDrizzleSession } from "../../infrastructure/sqlite/sqlite-drizzle-client";
import { workspaceSessions } from "./sqlite-legacy-workspace-session-schema";

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

const TASK_WORKFLOW_ARTIFACT_FORMAT_PLAIN_TEXT = "plain_text";
const TASK_WORKFLOW_ARTIFACT_FORMATS = [TASK_WORKFLOW_ARTIFACT_FORMAT_PLAIN_TEXT] as const;
const TASK_ASSET_SCOPES = nonEmptyEnumOptions(taskAssetScopeSchema.options, "taskAssetScopeSchema");

export const tasks = sqliteTable("tasks", {
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
});

export const taskArtifacts = sqliteTable("tasks_artifacts", {
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
});

export const taskAssets = sqliteTable("task_assets", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  scope: text("scope", { enum: TASK_ASSET_SCOPES }).notNull(),
  originalName: text("original_name").notNull(),
  mediaType: text("media_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  createdAt: integer("created_at_ms", { mode: "timestamp_ms" }).notNull(),
});

export const legacyTaskStoreSchema = {
  workspaceSessions,
  taskAssets,
  taskArtifacts,
  tasks,
};

export type LegacyTaskStoreSession = SqliteDrizzleSession<typeof legacyTaskStoreSchema>;
