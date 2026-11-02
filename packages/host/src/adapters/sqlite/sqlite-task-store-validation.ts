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
