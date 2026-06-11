import { type AgentSessionRecord, agentSessionRecordSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage } from "../../effect/host-errors";
import { SqliteTaskStoreDataError } from "./sqlite-task-store-errors";
import type { TaskRow } from "./sqlite-task-store-schema";

type SafeParseResult<A> =
  | { readonly success: true; readonly data: A }
  | { readonly success: false; readonly error: { readonly message: string } };

type SafeParser<A> = {
  readonly safeParse: (value: unknown) => SafeParseResult<A>;
};

export const normalizeLabels = (labels: string[]): string[] =>
  Array.from(new Set(labels.map((label) => label.trim()).filter(Boolean))).sort();

export const encodeJson = (value: unknown): string => JSON.stringify(value);

export const decodeWithSchema = <A>(
  parser: SafeParser<A>,
  value: unknown,
  field: string,
  details?: Readonly<Record<string, unknown>>,
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
  fallback: unknown,
  field: string,
  taskId: string,
): Effect.Effect<unknown, SqliteTaskStoreDataError> => {
  if (value === null) {
    return Effect.succeed(fallback);
  }
  return Effect.try({
    try: () => JSON.parse(value),
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
  fallback: unknown,
  parse: (value: unknown) => Effect.Effect<A, SqliteTaskStoreDataError>,
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
      return Effect.succeed(normalizeLabels(value));
    },
    "labels_json",
    row.id,
  );

export const agentSessionsFromRow = (
  row: TaskRow,
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
  parse: (value: unknown) => Effect.Effect<A, SqliteTaskStoreDataError>,
): Effect.Effect<A | undefined, SqliteTaskStoreDataError> =>
  parseJsonColumn(
    row[field],
    null,
    (value) => (value === null ? Effect.succeed(undefined) : parse(value)),
    field,
    row.id,
  );
