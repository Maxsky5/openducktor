import { gitTargetBranchSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  SqliteTaskStoreDataError,
  type SqliteTaskStoreDataErrorDetails,
} from "./sqlite-task-store-errors";

type SafeParseResult<A> =
  | { readonly success: true; readonly data: A }
  | { readonly success: false; readonly error: { readonly message: string } };

type SafeParser<Input, Output> = {
  readonly safeParse: (value: Input) => SafeParseResult<Output>;
};

export const taskTargetBranchFromRow = (
  row: { id: string; targetBranch: string | null; targetRemote: string | null },
  workspaceId: string,
) =>
  row.targetBranch === null
    ? Effect.succeed(undefined)
    : validateWithSchema(
        gitTargetBranchSchema,
        { branch: row.targetBranch, remote: row.targetRemote ?? undefined },
        "target branch",
        { workspaceId, taskId: row.id },
      );

export const validateWithSchema = <Input, Output>(
  parser: SafeParser<Input, Output>,
  value: Input,
  field: string,
  details?: Readonly<SqliteTaskStoreDataErrorDetails>,
): Effect.Effect<Output, SqliteTaskStoreDataError> => {
  const parsed = parser.safeParse(value);
  if (parsed.success) {
    return Effect.succeed(parsed.data);
  }
  if (details !== undefined) {
    return Effect.fail(
      new SqliteTaskStoreDataError({
        message: `Invalid SQLite task-store ${field}: ${parsed.error.message}`,
        field,
        details,
      }),
    );
  }
  return Effect.fail(
    new SqliteTaskStoreDataError({
      message: `Invalid SQLite task-store ${field}: ${parsed.error.message}`,
      field,
    }),
  );
};
