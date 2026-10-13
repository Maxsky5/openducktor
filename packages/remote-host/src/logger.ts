import { Effect } from "effect";
import { errorMessage, WebResourceError } from "./effect/web-errors";
export type WebLogger = {
  error(message: string): Effect.Effect<void, unknown>;
  info(message: string): Effect.Effect<void, unknown>;
  success(message: string): Effect.Effect<void, unknown>;
};
export const writeWebLogEffect = (
  logger: WebLogger,
  level: keyof WebLogger,
  message: string,
): Effect.Effect<void, WebResourceError> =>
  logger[level](message).pipe(
    Effect.mapError(
      (cause) =>
        new WebResourceError({
          resource: "persistent-log",
          operation: `remote.log-${level}`,
          message: errorMessage(cause),
          cause,
        }),
    ),
  );
