import { type RuntimeKind, runtimeKindSchema } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { and, asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { type HostError, isHostError, toHostOperationError } from "../../effect/host-errors";
import type { SqliteDrizzleExecutor } from "../../infrastructure/sqlite/sqlite-drizzle-client";
import type {
  AgentSessionTurnRecord,
  AgentSessionTurnSessionKey,
  AgentSessionTurnStorePort,
} from "../../ports/agent-session-turn-store-port";
import { type AgentSessionTurnRow, agentSessionTurns } from "./sqlite-agent-session-turn-schema";
import type { hostDatabaseSchema } from "./sqlite-host-database-schema";
import type { SqliteHostDatabaseManager } from "./sqlite-task-repository-context";

type HostDatabaseExecutor = SqliteDrizzleExecutor<typeof hostDatabaseSchema>;

const toIso = (milliseconds: number): string => new Date(milliseconds).toISOString();

const sessionTurns = (session: AgentSessionTurnSessionKey) =>
  and(
    eq(agentSessionTurns.runtimeKind, session.runtimeKind),
    eq(agentSessionTurns.externalSessionId, session.externalSessionId),
  );

const toModel = (row: AgentSessionTurnRow, runtimeKind: RuntimeKind) => {
  if (row.modelProviderId === null || row.modelId === null) return undefined;
  const model: AgentModelSelection = {
    runtimeKind,
    providerId: row.modelProviderId,
    modelId: row.modelId,
  };
  if (row.modelVariant !== null) model.variant = row.modelVariant;
  if (row.modelProfileId !== null) model.profileId = row.modelProfileId;
  if (row.modelSpeed !== null) model.speed = row.modelSpeed;
  return model;
};

const toRecord = (row: AgentSessionTurnRow): AgentSessionTurnRecord => {
  const runtimeKind = runtimeKindSchema.parse(row.runtimeKind);
  const model = toModel(row, runtimeKind);
  return {
    runtimeKind,
    externalSessionId: row.externalSessionId,
    userMessageId: row.userMessageId,
    userMessageHash: row.userMessageHash,
    startedAt: toIso(row.startedAt),
    ...(model && { model }),
    ...(row.completedAt !== null && { completedAt: toIso(row.completedAt) }),
    ...(row.outcome !== null && { outcome: row.outcome }),
    ...(row.durationMs !== null && { durationMs: row.durationMs }),
    ...(row.finalMessageId !== null && { finalMessageId: row.finalMessageId }),
    ...(row.interruptionMessageId !== null &&
      row.interruptionMessage !== null && {
        interruption: { messageId: row.interruptionMessageId, message: row.interruptionMessage },
      }),
  };
};

/** Saves the turns of runtime sessions in the host database. */
export const createSqliteAgentSessionTurnStore = (
  database: Pick<SqliteHostDatabaseManager, "withHostDatabase">,
): AgentSessionTurnStorePort => {
  const query = <A>(
    operation: string,
    run: (db: HostDatabaseExecutor) => PromiseLike<A>,
  ): Effect.Effect<A, HostError> =>
    database
      .withHostDatabase(operation, (session) => session.execute(run, operation))
      .pipe(
        Effect.mapError((cause) =>
          isHostError(cause) ? cause : toHostOperationError(cause, operation),
        ),
      );

  return {
    recordTurnStart: (start) =>
      query("agentSessionTurns.recordTurnStart", (db) =>
        db
          .insert(agentSessionTurns)
          .values({
            runtimeKind: start.runtimeKind,
            externalSessionId: start.externalSessionId,
            userMessageId: start.userMessageId,
            workspaceId: start.workspaceId,
            userMessageHash: start.userMessageHash,
            startedAt: Date.parse(start.startedAt),
            modelProviderId: start.model?.providerId ?? null,
            modelId: start.model?.modelId ?? null,
            modelVariant: start.model?.variant ?? null,
            modelProfileId: start.model?.profileId ?? null,
            modelSpeed: start.model?.speed ?? null,
          })
          .onConflictDoNothing(),
      ).pipe(Effect.asVoid),
    recordTurnEnd: (end) =>
      query("agentSessionTurns.recordTurnEnd", (db) =>
        db
          .update(agentSessionTurns)
          .set({
            completedAt: Date.parse(end.completedAt),
            outcome: end.outcome,
            durationMs: end.durationMs ?? null,
            finalMessageId: end.finalMessageId ?? null,
            interruptionMessageId: end.interruption?.messageId ?? null,
            interruptionMessage: end.interruption?.message ?? null,
          })
          .where(and(sessionTurns(end), eq(agentSessionTurns.userMessageId, end.userMessageId))),
      ).pipe(Effect.asVoid),
    listTurns: (session) =>
      query("agentSessionTurns.listTurns", (db) =>
        db
          .select()
          .from(agentSessionTurns)
          .where(sessionTurns(session))
          .orderBy(asc(agentSessionTurns.startedAt)),
      ).pipe(
        Effect.flatMap((rows) =>
          Effect.try({
            try: () => rows.map(toRecord),
            catch: (cause) => toHostOperationError(cause, "agentSessionTurns.listTurns"),
          }),
        ),
      ),
  };
};
