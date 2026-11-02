import { sql } from "drizzle-orm";
import { column } from "./sqlite-schema-sql";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { workspaces } from "./sqlite-host-settings-schema";

export const workspaceSessions = sqliteTable(
  "workspace_sessions",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.workspaceId, { onDelete: "cascade" }),
    id: text("id").notNull(),
    runtimeKind: text("runtime_kind").notNull(),
    externalSessionId: text("external_session_id"),
    executionKind: text("execution_kind", {
      enum: ["local_repo_root", "local_worktree"],
    }).notNull(),
    workingDirectory: text("working_directory").notNull(),
    branchName: text("branch_name"),
    worktreeState: text("worktree_state", { enum: ["present", "removed"] }),
    roleSnapshotId: text("role_snapshot_id"),
    roleSnapshotName: text("role_snapshot_name"),
    roleSnapshotSystemPrompt: text("role_snapshot_system_prompt"),
    modelRuntimeKind: text("model_runtime_kind"),
    modelProviderId: text("model_provider_id"),
    modelId: text("model_id"),
    modelVariant: text("model_variant"),
    modelProfileId: text("model_profile_id"),
    modelSpeed: text("model_speed"),
    generatedTitle: text("generated_title"),
    manualTitle: text("manual_title"),
    targetBranch: text("target_branch"),
    targetRemote: text("target_remote"),
    createdAt: integer("created_at_ms").notNull(),
    lastActivityAt: integer("last_activity_at_ms"),
    updatedAt: integer("updated_at_ms").notNull(),
    archivedAt: integer("archived_at_ms"),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    uniqueIndex("idx_workspace_sessions_runtime_identity").on(
      table.workspaceId,
      table.runtimeKind,
      table.externalSessionId,
    ),
    index("idx_workspace_sessions_active_updated").on(
      table.workspaceId,
      table.archivedAt,
      table.updatedAt,
    ),
    check(
      "chk_workspace_sessions_execution",
      sql`(${column(table.executionKind)} = 'local_repo_root' and ${column(table.branchName)} is null and ${column(table.worktreeState)} is null) or (${column(table.executionKind)} = 'local_worktree' and ${column(table.worktreeState)} in ('present', 'removed'))`,
    ),
    check(
      "chk_workspace_sessions_role",
      sql`(${column(table.roleSnapshotId)} is null and ${column(table.roleSnapshotName)} is null and ${column(table.roleSnapshotSystemPrompt)} is null) or (${column(table.roleSnapshotId)} is not null and ${column(table.roleSnapshotName)} is not null and ${column(table.roleSnapshotSystemPrompt)} is not null)`,
    ),
    check(
      "chk_workspace_sessions_model",
      sql`(${column(table.modelRuntimeKind)} is null and ${column(table.modelProviderId)} is null and ${column(table.modelId)} is null and ${column(table.modelVariant)} is null and ${column(table.modelProfileId)} is null and ${column(table.modelSpeed)} is null) or (${column(table.modelRuntimeKind)} = ${column(table.runtimeKind)} and ${column(table.modelProviderId)} is not null and ${column(table.modelId)} is not null)`,
    ),
  ],
);

export type WorkspaceSessionRow = typeof workspaceSessions.$inferSelect;
