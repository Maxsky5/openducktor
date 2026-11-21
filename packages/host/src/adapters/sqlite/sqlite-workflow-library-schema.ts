import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { workspaces } from "./sqlite-host-settings-schema";
import { column } from "./sqlite-schema-sql";

/**
 * A custom workflow. The built-in workflow has no row. A delete while closed tasks use the workflow
 * sets `deleted_at_ms` and keeps the published versions, so those tasks still open. The ID stays
 * taken.
 */
export const workflows = sqliteTable("workflows", {
  workflowId: text("workflow_id").primaryKey().notNull(),
  createdAtMs: integer("created_at_ms").notNull(),
  deletedAtMs: integer("deleted_at_ms"),
});

/** The one draft of a workflow. `document_json` holds a `workflowDocumentSchema` value. */
export const workflowDrafts = sqliteTable("workflow_drafts", {
  workflowId: text("workflow_id")
    .primaryKey()
    .notNull()
    .references(() => workflows.workflowId, { onDelete: "cascade", onUpdate: "cascade" }),
  updatedAtMs: integer("updated_at_ms").notNull(),
  documentJson: text("document_json").notNull(),
});

/** An immutable published version. `document_json` holds a `workflowVersionDocumentSchema` value. */
export const workflowVersions = sqliteTable(
  "workflow_versions",
  {
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.workflowId, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    publishedAtMs: integer("published_at_ms").notNull(),
    documentJson: text("document_json").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workflowId, table.version] }),
    check("chk_workflow_versions_version", sql`${column(table.version)} >= 1`),
  ],
);

/** A custom role. `updated_at_ms` is the role freshness mark of the host version cache. */
export const workflowRoles = sqliteTable("workflow_roles", {
  roleId: text("role_id").primaryKey().notNull(),
  updatedAtMs: integer("updated_at_ms").notNull(),
  definitionJson: text("definition_json").notNull(),
});

/**
 * Which workspaces can use a workflow. A workflow without a row is available to every workspace.
 * The built-in workflow has no `workflows` row, so this table has no foreign key to it.
 */
export const workflowAvailability = sqliteTable(
  "workflow_availability",
  {
    workflowId: text("workflow_id").primaryKey().notNull(),
    /** `only`: the listed workspaces. `except`: every workspace but the listed ones. */
    mode: text("mode", { enum: ["only", "except"] }).notNull(),
  },
  (table) => [
    check("chk_workflow_availability_mode", sql`${column(table.mode)} in ('only', 'except')`),
  ],
);

/** The workspaces that the availability of a workflow lists. */
export const workflowAvailabilityWorkspaces = sqliteTable(
  "workflow_availability_workspaces",
  {
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflowAvailability.workflowId, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.workspaceId, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.workflowId, table.workspaceId] })],
);

export const workflowLibrarySchema = {
  workflows,
  workflowDrafts,
  workflowVersions,
  workflowRoles,
  workflowAvailability,
  workflowAvailabilityWorkspaces,
};
