import {
  type AgentSessionRecord,
  agentSessionRecordSchema,
  type JsonValue,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage } from "../../effect/host-errors";
import { SqliteTaskStoreDataError } from "./sqlite-task-store-errors";
import type { TaskRow } from "./sqlite-task-store-schema";

type SafeParseResult<A> =
  | { readonly success: true; readonly data: A }
  | { readonly success: false; readonly error: { readonly message: string } };

type SafeParser<A> = {
  readonly safeParse: (value: JsonValue | A) => SafeParseResult<A>;
};

export const normalizeLabels = (labels: string[]): string[] =>
  Array.from(new Set(labels.map((label) => label.trim()).filter(Boolean))).sort();

export const encodeJson = <A>(value: A): string => JSON.stringify(value);

export const decodeWithSchema = <A>(
  parser: SafeParser<A>,
  value: JsonValue | A,
  field: string,
  details?: Readonly<Record<string, JsonValue>>,
): Effect.Effect<A, SqliteTaskStoreDataError> => {
  const parsed = parser.safeParse(value);
  if (parsed.success) {
    return Effect.succeed(parsed.data);
  }
  return Effect.fail(
    new SqliteTaskStoreDataError({
      message: `Invalid SQLite task-store ${field}: ${parsed.error.message}`,
      field,
      details,
    }),
  );
};

export const parseJsonColumnValue = (
  value: string | null,
  fallback: JsonValue,
  field: string,
  taskId: string,
): Effect.Effect<JsonValue, SqliteTaskStoreDataError> => {
  if (value === null) {
    return Effect.succeed(fallback);
  }
  return Effect.try({
    // SAFETY: JSON.parse returns JSON-compatible values for a SQLite JSON column.
    try: () => JSON.parse(value) as JsonValue,
    catch: (cause) =>
      new SqliteTaskStoreDataError({
        message: `Invalid SQLite task ${taskId} ${field} JSON: ${errorMessage(cause)}`,
        field,
        cause,
        details: { taskId },
      }),
  });
};

const parseJsonColumn = <A>(
  value: string | null,
  fallback: JsonValue,
  parse: (value: JsonValue) => Effect.Effect<A, SqliteTaskStoreDataError>,
  field: string,
  taskId: string,
): Effect.Effect<A, SqliteTaskStoreDataError> =>
  Effect.gen(function* () {
    const raw = yield* parseJsonColumnValue(value, fallback, field, taskId);
    return yield* parse(raw);
  });

export const labelsFromRow = (row: TaskRow): Effect.Effect<string[], SqliteTaskStoreDataError> =>
  parseJsonColumn(
    row.labelsJson,
    [],
    (value) => {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
        return Effect.fail(
          new SqliteTaskStoreDataError({
            message: "SQLite labels_json must be an array of strings.",
            field: "labels_json",
            details: { taskId: row.id },
          }),
        );
      }
      // SAFETY: the check above guarantees every array entry is a string.
      return Effect.succeed(normalizeLabels(value as string[]));
    },
    "labels_json",
    row.id,
  );

export const agentSessionsFromRow = (
  row: Pick<TaskRow, "agentSessionsJson" | "id">,
): Effect.Effect<AgentSessionRecord[], SqliteTaskStoreDataError> =>
  parseJsonColumn(
    row.agentSessionsJson,
    [],
    (value) =>
      decodeWithSchema(agentSessionRecordSchema.array(), value, "agent_sessions_json", {
        taskId: row.id,
      }),
    "agent_sessions_json",
    row.id,
  ).pipe(
    Effect.map((sessions) =>
      sessions.sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
    ),
  );

export const optionalJsonFromRow = <A>(
  row: TaskRow,
  field: keyof Pick<TaskRow, "directMergeJson" | "pullRequestJson" | "targetBranchJson">,
  parse: (value: JsonValue) => Effect.Effect<A, SqliteTaskStoreDataError>,
): Effect.Effect<A | undefined, SqliteTaskStoreDataError> =>
  parseJsonColumn(
    row[field],
    null,
    (value) => (value === null ? Effect.succeed(undefined) : parse(value)),
    field,
    row.id,
  );
