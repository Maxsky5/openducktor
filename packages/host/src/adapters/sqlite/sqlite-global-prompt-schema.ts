import { PROMPT_OWNER_KINDS } from "@openducktor/contracts";
import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { booleanCheck, column } from "./sqlite-schema-sql";

// The global prompt tables live here so that the settings schema stays under the line limit. The
// workspace prompt tables stay in the settings schema, because they reference its workspaces table.
// The owner kind is an open list, so `packages/contracts` validates it and no CHECK holds it.

export const globalPromptOverrides = sqliteTable(
  "global_prompt_overrides",
  {
    ownerKind: text("owner_kind", { enum: PROMPT_OWNER_KINDS }).notNull(),
    ownerId: text("owner_id").notNull(),
    promptId: text("prompt_id").notNull(),
    template: text("template").notNull(),
    baseVersion: integer("base_version").notNull(),
    enabled: integer("enabled", { mode: "boolean" }),
  },
  (table) => [
    primaryKey({ columns: [table.ownerKind, table.ownerId, table.promptId] }),
    check("chk_global_prompt_overrides_base_version", sql`${column(table.baseVersion)} >= 1`),
    check("chk_global_prompt_overrides_enabled", booleanCheck(table.enabled)),
  ],
);

export const globalPromptAppends = sqliteTable(
  "global_prompt_appends",
  {
    ownerKind: text("owner_kind", { enum: PROMPT_OWNER_KINDS }).notNull(),
    ownerId: text("owner_id").notNull(),
    promptId: text("prompt_id").notNull(),
    text: text("text").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerKind, table.ownerId, table.promptId] }),
    check("chk_global_prompt_appends_enabled", booleanCheck(table.enabled)),
  ],
);

export const globalPromptSchema = { globalPromptOverrides, globalPromptAppends };
