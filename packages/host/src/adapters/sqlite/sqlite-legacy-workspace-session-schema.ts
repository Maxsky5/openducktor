import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workspaceSessions = sqliteTable("workspace_sessions", {
  id: text("id").primaryKey(),
  runtimeKind: text("runtime_kind").notNull(),
  externalSessionId: text("external_session_id"),
  executionTargetJson: text("execution_target_json").notNull(),
  roleSnapshotJson: text("role_snapshot_json"),
  selectedModelJson: text("selected_model_json"),
  generatedTitle: text("generated_title"),
  manualTitle: text("manual_title"),
  targetBranchJson: text("target_branch_json"),
  createdAt: integer("created_at_ms").notNull(),
  lastActivityAt: integer("last_activity_at_ms"),
  updatedAt: integer("updated_at_ms").notNull(),
  archivedAt: integer("archived_at_ms"),
});
