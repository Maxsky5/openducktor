import {
  type AgentSessionRecord,
  agentSessionRecordSchema,
  type JsonValue,
  jsonValueSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import { errorMessage } from "../../effect/host-errors";
import {
  SqliteTaskStoreDataError,
  type SqliteTaskStoreDataErrorDetails,
} from "./sqlite-task-store-errors";
import type { TaskRow } from "./sqlite-task-store-schema";

type SafeParseResult<A> =
  | { readonly success: true; readonly data: A }
  | { readonly success: false; readonly error: { readonly message: string } };

type SafeParser<Input, Output> = {
  readonly safeParse: (value: Input) => SafeParseResult<Output>;
};

const labelsSchema = z.array(z.string());

export const normalizeLabels = (labels: string[]): string[] =>
  Array.from(new Set(labels.map((label) => label.trim()).filter(Boolean))).sort();

export const encodeJson = (value: JsonValue): string => JSON.stringify(value);

export const toValidatedJsonValue = (result: z.ZodSafeParseResult<JsonValue>): JsonValue => {
  if (result.success) {
    return result.data;
  }
  throw result.error;
};

const parseWithSchema = <Input, Output>(
  parser: SafeParser<Input, Output>,
  value: Input,
  field: string,
  details?: Readonly<SqliteTaskStoreDataErrorDetails>,
): Effect.Effect<Output, SqliteTaskStoreDataError> => {
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

export const decodeWithSchema = <A>(
  parser: SafeParser<JsonValue, A>,
  value: JsonValue,
  field: string,
  details?: Readonly<SqliteTaskStoreDataErrorDetails>,
): Effect.Effect<A, SqliteTaskStoreDataError> => parseWithSchema(parser, value, field, details);

export const validateWithSchema = <Input, Output>(
  parser: SafeParser<Input, Output>,
  value: Input,
  field: string,
  details?: Readonly<SqliteTaskStoreDataErrorDetails>,
): Effect.Effect<Output, SqliteTaskStoreDataError> =>
  parseWithSchema(parser, value, field, details);

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
    try: () => jsonValueSchema.parse(JSON.parse(value)),
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
      const parsed = labelsSchema.safeParse(value);
      if (!parsed.success) {
        return Effect.fail(
          new SqliteTaskStoreDataError({
            message: "SQLite labels_json must be an array of strings.",
            field: "labels_json",
            details: { taskId: row.id },
          }),
        );
      }
      return Effect.succeed(normalizeLabels(parsed.data));
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
