import type { RuntimeSessionImportPort as NativePort } from "@openducktor/core";
import { Effect } from "effect";
import { toHostOperationError } from "../../effect/host-errors";
import type { RuntimeSessionImportPort } from "../../ports/runtime-session-import-port";

export const createRuntimeSessionImportAdapter = (
  native: NativePort,
): RuntimeSessionImportPort => ({
  scanSessions: (signal) => {
    const iterator = native.scanSessions(signal)[Symbol.asyncIterator]();
    return {
      next: () =>
        Effect.tryPromise({
          try: () => iterator.next(),
          catch: (cause) => toHostOperationError(cause, "sessionImport.scanSessions"),
        }),
    };
  },
  inspectSession: (input) =>
    Effect.tryPromise({
      try: () => native.inspectSession(input),
      catch: (cause) => toHostOperationError(cause, "sessionImport.inspectSession"),
    }).pipe(
      Effect.map((source) => ({
        metadata: source.metadata,
        selectedModel: source.selectedModel,
        attach: Effect.tryPromise({
          try: () => source.attach(),
          catch: (cause) => toHostOperationError(cause, "sessionImport.attach"),
        }),
      })),
    ),
});
