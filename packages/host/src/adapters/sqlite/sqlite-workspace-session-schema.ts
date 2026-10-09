import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const workspaceSessions = sqliteTable(
  "workspace_sessions",
  {
    id: text("id").primaryKey(),
    runtimeKind: text("runtime_kind").notNull(),
    externalSessionId: text("external_session_id"),
    executionTargetJson: text("execution_target_json").notNull(),
    roleSnapshotJson: text("role_snapshot_json"),
    selectedModelJson: text("selected_model_json"),
    speed: text("speed").default("standard"),
    generatedTitle: text("generated_title"),
    manualTitle: text("manual_title"),
    createdAt: integer("created_at_ms").notNull(),
    lastActivityAt: integer("last_activity_at_ms"),
    updatedAt: integer("updated_at_ms").notNull(),
    archivedAt: integer("archived_at_ms"),
  },
  (table) => [
    check(
      "workspace_sessions_speed",
      sql`${table.speed} IS NULL OR length(trim(${table.speed})) > 0`,
    ),
    uniqueIndex("idx_workspace_sessions_runtime_identity").on(
      table.runtimeKind,
      table.externalSessionId,
    ),
    index("idx_workspace_sessions_active_updated").on(table.archivedAt, table.updatedAt),
  ],
);

export type WorkspaceSessionRow = typeof workspaceSessions.$inferSelect;
