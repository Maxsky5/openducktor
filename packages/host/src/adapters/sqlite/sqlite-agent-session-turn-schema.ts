import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { workspaces } from "./sqlite-host-settings-schema";
import { column, enumCheck } from "./sqlite-schema-sql";

const TURN_OUTCOMES = ["completed", "interrupted", "failed"] as const;

/**
 * One turn of a runtime session as the host saw it live: a user message that the runtime
 * accepted, and the end of the run when it is the last message of the run. A runtime session ID
 * is unique for its runtime, so the runtime identity and the user message ID name a turn. Each row
 * keeps the runtime and model of its turn, so turns of several runtime sessions can form one
 * conversation.
 */
export const agentSessionTurns = sqliteTable(
  "agent_session_turns",
  {
    runtimeKind: text("runtime_kind").notNull(),
    externalSessionId: text("external_session_id").notNull(),
    userMessageId: text("user_message_id").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.workspaceId, { onDelete: "cascade" }),
    userMessageHash: text("user_message_hash").notNull(),
    startedAt: integer("started_at_ms").notNull(),
    completedAt: integer("completed_at_ms"),
    durationMs: integer("duration_ms"),
    outcome: text("outcome", { enum: TURN_OUTCOMES }),
    finalMessageId: text("final_message_id"),
    interruptionMessageId: text("interruption_message_id"),
    interruptionMessage: text("interruption_message"),
    modelProviderId: text("model_provider_id"),
    modelId: text("model_id"),
    modelVariant: text("model_variant"),
    modelProfileId: text("model_profile_id"),
    modelSpeed: text("model_speed"),
  },
  (table) => [
    primaryKey({ columns: [table.runtimeKind, table.externalSessionId, table.userMessageId] }),
    index("idx_agent_session_turns_workspace").on(table.workspaceId),
    check(
      "chk_agent_session_turns_outcome",
      sql`${column(table.outcome)} is null or ${enumCheck(table.outcome, TURN_OUTCOMES)}`,
    ),
    check(
      "chk_agent_session_turns_end",
      sql`(${column(table.completedAt)} is null and ${column(table.outcome)} is null and ${column(table.durationMs)} is null and ${column(table.finalMessageId)} is null and ${column(table.interruptionMessageId)} is null) or (${column(table.completedAt)} is not null and ${column(table.outcome)} is not null)`,
    ),
    check(
      "chk_agent_session_turns_interruption",
      sql`(${column(table.interruptionMessageId)} is null) = (${column(table.interruptionMessage)} is null)`,
    ),
    check(
      "chk_agent_session_turns_duration",
      sql`${column(table.durationMs)} is null or ${column(table.durationMs)} >= 0`,
    ),
    check(
      "chk_agent_session_turns_model",
      sql`(${column(table.modelProviderId)} is null and ${column(table.modelId)} is null and ${column(table.modelVariant)} is null and ${column(table.modelProfileId)} is null and ${column(table.modelSpeed)} is null) or (${column(table.modelProviderId)} is not null and ${column(table.modelId)} is not null)`,
    ),
  ],
);

export type AgentSessionTurnRow = typeof agentSessionTurns.$inferSelect;
