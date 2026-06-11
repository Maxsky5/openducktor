import { pullRequestSchema } from "@openducktor/contracts";
import { and, asc, desc, isNotNull, ne } from "drizzle-orm";
import { Effect } from "effect";
import type { PullRequestSyncCandidate } from "../../ports/task-repository-ports";
import { decodeWithSchema, parseJsonColumnValue } from "./sqlite-json-codecs";
import {
  SqliteTaskStoreDataError,
  type SqliteTaskStoreReadError,
} from "./sqlite-task-store-errors";
import { type TaskStoreSession, tasks } from "./sqlite-task-store-schema";

const parsePullRequestJson = (
  taskId: string,
  value: string | null,
): Effect.Effect<PullRequestSyncCandidate["pullRequest"], SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    if (value === null) {
      return yield* new SqliteTaskStoreDataError({
        message: "SQLite pull_request_json must be present for pull request sync candidates.",
        field: "pull_request_json",
        details: { taskId },
      });
    }
    const raw = yield* parseJsonColumnValue(value, null, "pull_request_json", taskId);
    return yield* decodeWithSchema(pullRequestSchema, raw, "pull_request_json", { taskId });
  });

const isSyncablePullRequestState = (
  state: PullRequestSyncCandidate["pullRequest"]["state"],
): boolean => state === "open" || state === "draft";

const isCandidate = (
  candidate: PullRequestSyncCandidate | null,
): candidate is PullRequestSyncCandidate => candidate !== null;

export const listPullRequestSyncCandidatesInDatabase = (
  session: TaskStoreSession,
): Effect.Effect<PullRequestSyncCandidate[], SqliteTaskStoreReadError> =>
  Effect.gen(function* () {
    const rows = yield* session.execute(
      (database) =>
        database
          .select({
            id: tasks.id,
            pullRequestJson: tasks.pullRequestJson,
            status: tasks.status,
          })
          .from(tasks)
          .where(and(ne(tasks.status, "closed"), isNotNull(tasks.pullRequestJson)))
          .orderBy(desc(tasks.updatedAt), asc(tasks.id)),
      "sqliteTaskStore.listPullRequestSyncCandidates.selectTasks",
    );

    const candidates = yield* Effect.forEach(rows, (row) =>
      Effect.gen(function* () {
        const pullRequest = yield* parsePullRequestJson(row.id, row.pullRequestJson);
        if (!isSyncablePullRequestState(pullRequest.state)) {
          return null;
        }
        return {
          id: row.id,
          pullRequest,
          status: row.status,
        };
      }),
    );
    return candidates.filter(isCandidate);
  });
