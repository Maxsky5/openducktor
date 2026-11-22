import {
  handoffContextPrefixSchema,
  handoffLinkSchema,
  type AgentChatRef,
  type AgentSessionModelSelection,
  type HandoffContextPrefix,
  type HandoffLink,
} from "@openducktor/contracts";
import { and, asc, eq, inArray, isNotNull, max, sql } from "drizzle-orm";
import { Effect } from "effect";
import { hasSameAgentSessionIdentity } from "../../domain/agent-session-identity";
import { HostValidationError } from "../../effect/host-errors";
import type { SqliteTaskRepositoryContextProvider } from "./sqlite-task-repository-context";
import {
  runtimeHandoffs,
  tasks,
  taskSessions,
  workspaceSessions,
  type HostDatabaseSession,
} from "./sqlite-host-database-schema";
import { sqliteValues } from "./sqlite-parameters";
import { selectedModelColumns } from "./sqlite-session-model-columns";

type Row = typeof runtimeHandoffs.$inferSelect;

const chatFields = (chat: AgentChatRef) =>
  chat.kind === "workspace_session"
    ? { workspaceSessionId: chat.sessionId }
    : {
        taskId: chat.taskId,
        taskRole: chat.role,
        firstRuntime: chat.first.runtimeKind,
        firstSessionId: chat.first.externalSessionId,
        workingDirectory: chat.first.workingDirectory,
      };

const chatScope = (chat: AgentChatRef) =>
  and(
    eq(runtimeHandoffs.workspaceId, chat.workspaceId),
    chat.kind === "workspace_session"
      ? eq(runtimeHandoffs.workspaceSessionId, chat.sessionId)
      : and(
          eq(runtimeHandoffs.taskId, chat.taskId),
          eq(runtimeHandoffs.taskRole, chat.role),
          eq(runtimeHandoffs.firstRuntime, chat.first.runtimeKind),
          eq(runtimeHandoffs.firstSessionId, chat.first.externalSessionId),
          eq(runtimeHandoffs.workingDirectory, chat.first.workingDirectory),
        ),
  );

const readRows = (session: HostDatabaseSession, filter: ReturnType<typeof and>) =>
  session.execute(
    (db) => db.select().from(runtimeHandoffs).where(filter).orderBy(asc(runtimeHandoffs.ordinal)),
    "runtimeHandoffs.read",
  );

const readLink = (row: Row) =>
  Effect.try({
    try: () =>
      handoffLinkSchema.parse({
        from: {
          runtimeKind: row.sourceRuntime,
          externalSessionId: row.sourceSessionId,
          workingDirectory: row.workingDirectory,
        },
        to: {
          runtimeKind: row.targetRuntime,
          externalSessionId: row.targetSessionId,
          workingDirectory: row.workingDirectory,
        },
        firstMessageId: row.firstMessageId,
        partialHistory: row.partialHistory,
      }),
    catch: (cause) =>
      new HostValidationError({ message: "A saved runtime handoff link is invalid.", cause }),
  });

/** Reads the ordered links in the same statement as the task record. */
export const taskHandoffLinksSql = sql<string>`(
  select json_group_array(json_object(
    'from', json_object('runtimeKind', source_runtime, 'externalSessionId', source_session_id, 'workingDirectory', working_directory),
    'to', json_object('runtimeKind', target_runtime, 'externalSessionId', target_session_id, 'workingDirectory', working_directory),
    'firstMessageId', first_message_id,
    'partialHistory', json(case when partial_history then 'true' else 'false' end)
  ))
  from (
    select working_directory, source_runtime, source_session_id, target_runtime, target_session_id, first_message_id, partial_history
    from ${runtimeHandoffs}
    where ${and(
      eq(runtimeHandoffs.workspaceId, taskSessions.workspaceId),
      eq(runtimeHandoffs.taskId, taskSessions.taskId),
      eq(runtimeHandoffs.taskRole, taskSessions.role),
      eq(runtimeHandoffs.firstRuntime, taskSessions.runtimeKind),
      eq(runtimeHandoffs.firstSessionId, taskSessions.externalSessionId),
      eq(runtimeHandoffs.workingDirectory, taskSessions.workingDirectory),
    )}
    order by ${runtimeHandoffs.ordinal}
  )
)`;

export const readWorkspaceHandoffLinks = (
  session: HostDatabaseSession,
  workspaceId: string,
  ids: string[],
) =>
  Effect.gen(function* () {
    const groups = new Map<string, HandoffLink[]>();
    if (!ids.length) return groups;
    const rows = yield* readRows(
      session,
      and(
        eq(runtimeHandoffs.workspaceId, workspaceId),
        inArray(runtimeHandoffs.workspaceSessionId, sqliteValues(ids)),
      ),
    );
    for (const row of rows) {
      if (!row.workspaceSessionId) continue;
      const group = groups.get(row.workspaceSessionId) ?? [];
      group.push(yield* readLink(row));
      groups.set(row.workspaceSessionId, group);
    }
    return groups;
  });

const staleSource = () =>
  new HostValidationError({
    field: "expectedActive",
    message: "The active session changed. Reopen the chat and select the destination again.",
  });

const saveWorkspaceBinding = (
  tx: HostDatabaseSession,
  chat: Extract<AgentChatRef, { kind: "workspace_session" }>,
  link: HandoffLink,
  model: AgentSessionModelSelection,
  acceptedAt: number,
) =>
  Effect.gen(function* () {
    const scope = and(
      eq(workspaceSessions.workspaceId, chat.workspaceId),
      eq(workspaceSessions.id, chat.sessionId),
    );
    const source = yield* tx.execute(
      (db) => db.select().from(workspaceSessions).where(scope),
      "runtimeHandoffs.workspaceSource",
    );
    const [row] = source;
    if (
      !row ||
      row.archivedAt !== null ||
      row.runtimeKind !== link.from.runtimeKind ||
      row.externalSessionId !== link.from.externalSessionId ||
      row.workingDirectory !== link.from.workingDirectory
    )
      return yield* staleSource();
    yield* tx.execute(
      (db) =>
        db
          .update(workspaceSessions)
          .set({
            runtimeKind: link.to.runtimeKind,
            externalSessionId: link.to.externalSessionId,
            ...selectedModelColumns(model),
            lastActivityAt: Math.max(row.lastActivityAt ?? row.createdAt, acceptedAt),
            updatedAt: Math.max(row.updatedAt, acceptedAt),
          })
          .where(scope),
      "runtimeHandoffs.bindWorkspace",
    );
  });

const saveTaskBinding = (
  tx: HostDatabaseSession,
  chat: Extract<AgentChatRef, { kind: "task_session" }>,
  link: HandoffLink,
  model: AgentSessionModelSelection,
  acceptedAt: number,
) =>
  Effect.gen(function* () {
    const match = and(
      eq(taskSessions.workspaceId, chat.workspaceId),
      eq(taskSessions.taskId, chat.taskId),
    );
    const [source] = yield* tx.execute(
      (db) =>
        db
          .select({ position: taskSessions.position })
          .from(taskSessions)
          .innerJoin(
            tasks,
            and(eq(tasks.workspaceId, taskSessions.workspaceId), eq(tasks.id, taskSessions.taskId)),
          )
          .where(
            and(
              match,
              eq(taskSessions.role, chat.role),
              eq(taskSessions.runtimeKind, link.from.runtimeKind),
              eq(taskSessions.externalSessionId, link.from.externalSessionId),
              eq(taskSessions.workingDirectory, link.from.workingDirectory),
            ),
          ),
      "runtimeHandoffs.taskSource",
    );
    if (!source) return yield* staleSource();
    const [last] = yield* tx.execute(
      (db) =>
        db
          .select({ position: max(taskSessions.position) })
          .from(taskSessions)
          .where(match),
      "runtimeHandoffs.taskPosition",
    );
    yield* tx.execute(
      (db) =>
        db.insert(taskSessions).values({
          workspaceId: chat.workspaceId,
          taskId: chat.taskId,
          position: (last?.position ?? -1) + 1,
          role: chat.role,
          ...link.to,
          startedAt: acceptedAt,
          lastActivityAt: acceptedAt,
          ...selectedModelColumns(model),
        }),
      "runtimeHandoffs.bindTask",
    );
  });

export const createSqliteRuntimeHandoffStore = (database: SqliteTaskRepositoryContextProvider) => ({
  commit: (input: {
    chat: AgentChatRef;
    link: HandoffLink;
    model: AgentSessionModelSelection;
    acceptedAt: number;
    contextPrefix: HandoffContextPrefix | null;
  }) =>
    database(input.chat, "runtimeHandoffs.commit", ({ session }) =>
      session.transaction("runtimeHandoffs.commit", (tx) =>
        Effect.gen(function* () {
          const { chat, link, acceptedAt, model, contextPrefix } = input;
          const rows = yield* readRows(tx, chatScope(chat));
          const last = rows.at(-1);
          if (
            last?.targetRuntime === link.to.runtimeKind &&
            last.targetSessionId === link.to.externalSessionId
          )
            return;
          const active = last
            ? (yield* readLink(last)).to
            : chat.kind === "task_session"
              ? chat.first
              : link.from;
          if (
            !hasSameAgentSessionIdentity(active, link.from) ||
            link.from.workingDirectory !== link.to.workingDirectory
          )
            return yield* staleSource();
          yield* tx.execute(
            (db) =>
              db.insert(runtimeHandoffs).values({
                workspaceId: chat.workspaceId,
                ...chatFields(chat),
                workingDirectory: link.to.workingDirectory,
                ordinal: (last?.ordinal ?? -1) + 1,
                sourceRuntime: link.from.runtimeKind,
                sourceSessionId: link.from.externalSessionId,
                targetRuntime: link.to.runtimeKind,
                targetSessionId: link.to.externalSessionId,
                firstMessageId: link.firstMessageId,
                partialHistory: link.partialHistory,
                contextPrefix,
              }),
            "runtimeHandoffs.insert",
          );
          yield* chat.kind === "workspace_session"
            ? saveWorkspaceBinding(tx, chat, link, model, acceptedAt)
            : saveTaskBinding(tx, chat, link, model, acceptedAt);
        }),
      ),
    ),
  prefix: (input: {
    workspaceId: string;
    repoPath: string;
    runtimeKind: HandoffLink["to"]["runtimeKind"];
    externalSessionId: string;
    workingDirectory: string;
    candidate?: HandoffContextPrefix | undefined;
  }) =>
    database(input, "runtimeHandoffs.prefix", ({ session }) =>
      Effect.gen(function* () {
        const [row] = yield* readRows(
          session,
          and(
            eq(runtimeHandoffs.workspaceId, input.workspaceId),
            eq(runtimeHandoffs.targetRuntime, input.runtimeKind),
            input.candidate
              ? eq(runtimeHandoffs.contextPrefix, input.candidate)
              : and(
                  eq(runtimeHandoffs.targetSessionId, input.externalSessionId),
                  eq(runtimeHandoffs.workingDirectory, input.workingDirectory),
                  isNotNull(runtimeHandoffs.contextPrefix),
                ),
          ),
        );
        return row
          ? yield* Effect.try({
              try: () => ({
                firstMessageId: row.firstMessageId,
                receipt: handoffContextPrefixSchema.parse(row.contextPrefix),
              }),
              catch: (cause) =>
                new HostValidationError({
                  message: "The saved handoff context receipt is invalid.",
                  cause,
                }),
            })
          : null;
      }),
    ),
});
