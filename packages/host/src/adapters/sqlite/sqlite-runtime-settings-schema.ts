import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { booleanCheck, column } from "./sqlite-schema-sql";

export const agentRuntimeSettings = sqliteTable(
  "agent_runtime_settings",
  {
    runtimeKind: text("runtime_kind").primaryKey().notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    executablePath: text("executable_path").notNull(),
    policyJson: text("policy_json"),
  },
  (table) => [
    check("chk_agent_runtime_settings_enabled", booleanCheck(table.enabled)),
    // The policy schemas decide which runtimes need a policy, so a new runtime needs no rebuild.
    check(
      "chk_agent_runtime_settings_policy",
      sql`${column(table.policyJson)} is null or (json_valid(${column(table.policyJson)})
        and json_type(${column(table.policyJson)}) is 'object'
        and json_type(${column(table.policyJson)}, '$.defaults') is 'object'
        and json_type(${column(table.policyJson)}, '$.roleOverrides') is 'object')`,
    ),
  ],
);

export const runtimeSettingsSchema = { agentRuntimeSettings };
