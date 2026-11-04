import {
  agentSessionRecordSchema,
  directMergeRecordSchema,
  gitTargetBranchSchema,
  pullRequestSchema,
  sourceIssueReferenceSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { gt, sql } from "drizzle-orm";
import { getTableColumns } from "drizzle-orm";
import { sqliteBatches } from "./sqlite-parameters";
import { z, type JSONType } from "zod";
import { readLegacyTargetBranch } from "../../config/legacy-target-branch";
import { parseAgentSessionStartedAt } from "../../domain/agent-session-records";
import type { HostValidationError } from "../../effect/host-errors";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import {
  SqliteTaskStoreDataError,
  type SqliteTaskStoreDataErrorDetails,
  mapSqliteTaskStoreAdapterError,
} from "./sqlite-task-store-errors";
import {
  taskArtifacts,
  taskAssets,
  taskDirectMerges,
  taskIssueLinks,
  taskLabels,
  taskPullRequests,
  taskSessions,
  tasks,
  workspaceSessions,
  type HostDatabaseSession,
} from "./sqlite-host-database-schema";
import {
  tasks as legacyTasks,
  taskArtifacts as legacyArtifacts,
  taskAssets as legacyAssets,
  type LegacyTaskStoreSession,
} from "./sqlite-legacy-task-store-schema";
import { workspaceSessions as legacySessions } from "./sqlite-legacy-workspace-session-schema";
import { selectedModelColumns } from "./sqlite-task-relations";
import { encodeWorkspaceSessionRecord } from "./sqlite-workspace-session-reads";
import { workspaceSessionSchema } from "@openducktor/contracts";
import { directMergeRowValues, pullRequestRowValues } from "./sqlite-task-delivery-rows";

const legacyAgentSessionsSchema = agentSessionRecordSchema
  .extend({
    externalSessionId: z.string().refine((value) => value.trim().length > 0),
    workingDirectory: z.string().refine((value) => value.trim().length > 0),
  })
  .array();

const deliveryImportError = (
  cause: HostValidationError,
  sourcePath: string,
  workspaceId: string,
  taskId: string,
) =>
  new SqliteTaskStoreDataError({
    field: cause.field ?? "delivery",
    message: `Cannot migrate ${sourcePath}: ${cause.message}`,
    details: { workspaceId, taskId, sourcePath },
  });

/** Imports an already normalized snapshot. The caller owns the root import transaction. */
export const importLegacyWorkspaceTaskData = ({
  source,
  target,
  workspaceId,
  sourcePath,
}: {
  source: LegacyTaskStoreSession;
  target: HostDatabaseSession;
  workspaceId: string;
  sourcePath: string;
}): Effect.Effect<void, TaskStoreError> =>
  Effect.gen(function* () {
    const parse = <A>(
      schema: { parse: (value: JSONType) => A },
      value: JSONType,
      field: string,
      details: SqliteTaskStoreDataErrorDetails = {},
    ) =>
      Effect.try({
        try: () => schema.parse(value),
        catch: (cause) =>
          new SqliteTaskStoreDataError({
            field,
            message: `Cannot migrate ${sourcePath} ${field}. Correct the source record or restore a compatible backup, then restart.`,
            cause,
            details: { workspaceId, sourcePath, ...details },
          }),
      });
    const json = (value: string, field: string, details: SqliteTaskStoreDataErrorDetails = {}) =>
      Effect.try({
        try: () => z.json().parse(JSON.parse(value)),
        catch: (cause) =>
          new SqliteTaskStoreDataError({
            field,
            message: `Cannot read ${sourcePath} ${field} JSON. Correct the source record or restore a compatible backup, then restart.`,
            cause,
            details: { workspaceId, sourcePath, ...details },
          }),
      });
    let taskCursor: number | undefined;
    while (true) {
      const rows = yield* source.execute(
        (db) =>
          db
            .select({ ...getTableColumns(legacyTasks), cursor: sql<number>`rowid` })
            .from(legacyTasks)
            .where(taskCursor === undefined ? undefined : gt(sql`rowid`, taskCursor))
            .orderBy(sql`rowid`)
            .limit(100),
        "hostImport.tasks",
      );
      for (const { cursor, ...row } of rows) {
        taskCursor = cursor;
        const details = { taskId: row.id };
        const labels = yield* parse(
          z.string().array(),
          yield* json(row.labelsJson, "labels", details),
          "labels",
          details,
        );
        const sessions = yield* parse(
          legacyAgentSessionsSchema,
          yield* json(row.agentSessionsJson, "agentSessions", details),
          "agentSessions",
          details,
        );
        const targetBranch =
          row.targetBranchJson === null
            ? null
            : yield* parse(
                gitTargetBranchSchema,
                readLegacyTargetBranch(yield* json(row.targetBranchJson, "targetBranch", details)),
                "targetBranch",
                details,
              );
        const pullRequest =
          row.pullRequestJson === null
            ? null
            : yield* parse(
                pullRequestSchema,
                yield* json(row.pullRequestJson, "pullRequest", details),
                "pullRequest",
                details,
              );
        const directMerge =
          row.directMergeJson === null
            ? null
            : yield* parse(
                directMergeRecordSchema,
                yield* json(row.directMergeJson, "directMerge", details),
                "directMerge",
                details,
              );
        yield* target.execute(
          (db) =>
            db.insert(tasks).values({
              workspaceId,
              id: row.id,
              title: row.title,
              description: row.description,
              status: row.status,
              issueType: row.issueType,
              priority: row.priority,
              targetBranch: targetBranch?.branch ?? null,
              targetRemote: targetBranch?.remote ?? null,
              removeWorktreeOnClose: row.removeWorktreeOnClose,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            }),
          "hostImport.task",
        );
        for (const batch of sqliteBatches(
          labels.map((label, position) => ({ workspaceId, taskId: row.id, position, label })),
          4,
        ))
          yield* target.execute((db) => db.insert(taskLabels).values(batch), "hostImport.labels");
        for (const [position, record] of sessions.entries()) {
          const startedAt = parseAgentSessionStartedAt(record.startedAt);
          if (!startedAt.success)
            return yield* new SqliteTaskStoreDataError({
              field: "startedAt",
              message: `Cannot migrate ${sourcePath}: ${startedAt.message}`,
              details: {
                workspaceId,
                taskId: row.id,
                position,
                externalSessionId: record.externalSessionId,
                sourcePath,
              },
            });
          if (record.lastActivityAt !== undefined && !Number.isSafeInteger(record.lastActivityAt))
            return yield* new SqliteTaskStoreDataError({
              field: "lastActivityAt",
              message: `Cannot migrate ${sourcePath}: task session activity must be a nonnegative safe integer. Correct the source and restart.`,
              details: {
                workspaceId,
                taskId: row.id,
                position,
                externalSessionId: record.externalSessionId,
                sourcePath,
              },
            });
          yield* target.execute(
            (db) =>
              db.insert(taskSessions).values({
                workspaceId,
                taskId: row.id,
                position,
                externalSessionId: record.externalSessionId,
                role: record.role,
                runtimeKind: record.runtimeKind,
                workingDirectory: record.workingDirectory,
                startedAt: startedAt.milliseconds,
                lastActivityAt: record.lastActivityAt ?? null,
                ...selectedModelColumns(record.selectedModel),
              }),
            "hostImport.session",
          );
        }
        if (pullRequest !== null) {
          const values = yield* pullRequestRowValues(pullRequest).pipe(
            Effect.mapError((cause) => deliveryImportError(cause, sourcePath, workspaceId, row.id)),
          );
          yield* target.execute(
            (db) => db.insert(taskPullRequests).values({ ...values, workspaceId, taskId: row.id }),
            "hostImport.pullRequest",
          );
        }
        if (directMerge !== null) {
          const values = yield* directMergeRowValues(directMerge).pipe(
            Effect.mapError((cause) => deliveryImportError(cause, sourcePath, workspaceId, row.id)),
          );
          yield* target.execute(
            (db) => db.insert(taskDirectMerges).values({ ...values, workspaceId, taskId: row.id }),
            "hostImport.directMerge",
          );
        }
        const sourceValues = [
          row.sourceProviderId,
          row.sourceScope,
          row.sourceId,
          row.sourceNumber,
          row.sourceUrl,
        ];
        if (sourceValues.some((value) => value !== null)) {
          yield* parse(
            sourceIssueReferenceSchema,
            {
              providerId: row.sourceProviderId,
              scope: row.sourceScope,
              sourceId: row.sourceId,
              number: row.sourceNumber,
              url: row.sourceUrl,
            },
            "sourceIssue",
            details,
          );
          if (
            row.sourceProviderId === null ||
            row.sourceScope === null ||
            row.sourceId === null ||
            row.sourceNumber === null ||
            row.sourceUrl === null
          )
            return yield* new SqliteTaskStoreDataError({
              field: "sourceIssue",
              message: `Cannot migrate ${sourcePath}: task ${row.id} has an incomplete source issue link.`,
              details: { workspaceId, sourcePath, taskId: row.id },
            });
          const issueLink = {
            workspaceId,
            taskId: row.id,
            providerId: row.sourceProviderId,
            providerScope: row.sourceScope,
            externalId: row.sourceId,
            displayNumber: row.sourceNumber,
            url: row.sourceUrl,
          };
          yield* target.execute(
            (db) => db.insert(taskIssueLinks).values(issueLink),
            "hostImport.issueLink",
          );
        }
      }
      if (rows.length < 100) break;
    }
    // Each page contains whole artifacts. Four maximum-size files bound the BLOB buffer to 40 MiB.
    let artifactCursor: number | undefined;
    while (true) {
      const artifacts = yield* source.execute(
        (db) =>
          db
            .select({ ...getTableColumns(legacyArtifacts), cursor: sql<number>`rowid` })
            .from(legacyArtifacts)
            .where(artifactCursor === undefined ? undefined : gt(sql`rowid`, artifactCursor))
            .orderBy(sql`rowid`)
            .limit(4),
        "hostImport.artifacts",
      );
      for (const { cursor, ...row } of artifacts) {
        artifactCursor = cursor;
        yield* target.execute(
          (db) => db.insert(taskArtifacts).values({ ...row, workspaceId }),
          "hostImport.artifact",
        );
      }
      if (artifacts.length < 4) break;
    }
    let assetCursor: number | undefined;
    while (true) {
      const assets = yield* source.execute(
        (db) =>
          db
            .select({ ...getTableColumns(legacyAssets), cursor: sql<number>`rowid` })
            .from(legacyAssets)
            .where(assetCursor === undefined ? undefined : gt(sql`rowid`, assetCursor))
            .orderBy(sql`rowid`)
            .limit(100),
        "hostImport.assets",
      );
      for (const { cursor, ...row } of assets) {
        assetCursor = cursor;
        yield* target.execute(
          (db) => db.insert(taskAssets).values({ ...row, workspaceId }),
          "hostImport.asset",
        );
      }
      if (assets.length < 100) break;
    }
    let chatCursor: number | undefined;
    while (true) {
      const chats = yield* source.execute(
        (db) =>
          db
            .select({ ...getTableColumns(legacySessions), cursor: sql<number>`rowid` })
            .from(legacySessions)
            .where(chatCursor === undefined ? undefined : gt(sql`rowid`, chatCursor))
            .orderBy(sql`rowid`)
            .limit(100),
        "hostImport.workspaceSessions",
      );
      for (const { cursor, ...row } of chats) {
        chatCursor = cursor;
        const details = { sessionId: row.id };
        const legacySession: JSONType = {
          id: row.id,
          runtimeKind: row.runtimeKind,
          externalSessionId: row.externalSessionId,
          executionTarget: yield* json(row.executionTargetJson, "executionTarget", details),
          roleSnapshot:
            row.roleSnapshotJson === null
              ? null
              : yield* json(row.roleSnapshotJson, "roleSnapshot", details),
          selectedModel:
            row.selectedModelJson === null
              ? null
              : yield* json(row.selectedModelJson, "selectedModel", details),
          generatedTitle: row.generatedTitle,
          manualTitle: row.manualTitle,
          targetBranch:
            row.targetBranchJson === null
              ? null
              : readLegacyTargetBranch(yield* json(row.targetBranchJson, "targetBranch", details)),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          archivedAt: row.archivedAt,
        };
        if (row.lastActivityAt !== null) legacySession.lastActivityAt = row.lastActivityAt;
        const record = yield* parse(
          workspaceSessionSchema,
          legacySession,
          "workspaceSession",
          details,
        );
        yield* target.execute(
          (db) =>
            db.insert(workspaceSessions).values(encodeWorkspaceSessionRecord(workspaceId, record)),
          "hostImport.workspaceSession",
        );
      }
      if (chats.length < 100) break;
    }
  }).pipe(
    Effect.mapError((cause) =>
      mapSqliteTaskStoreAdapterError("hostImport.workspaceData", sourcePath, cause),
    ),
  );
