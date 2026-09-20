import type { ExternalRuntimeSessionsPort as NativePort } from "@openducktor/core";
import { Effect } from "effect";
import { toHostOperationError } from "../../effect/host-errors";
import type { ExternalRuntimeSessionsPort } from "../../ports/external-runtime-sessions-port";

export const createExternalRuntimeSessionsAdapter = (
  native: NativePort,
): ExternalRuntimeSessionsPort => ({
  list: (input) =>
    Effect.tryPromise({
      try: () => native.list(input),
      catch: (cause) => toHostOperationError(cause, "externalSessions.list"),
    }),
  inspect: (input) =>
    Effect.tryPromise({
      try: () => native.inspect(input),
      catch: (cause) => toHostOperationError(cause, "externalSessions.inspect"),
    }),
  prepare: (input) =>
    Effect.tryPromise({
      try: () => native.prepare(input),
      catch: (cause) => toHostOperationError(cause, "externalSessions.prepare"),
    }).pipe(
      Effect.map((handle) => ({
        metadata: handle.metadata,
        selectedModel: handle.selectedModel,
        commit: Effect.tryPromise({
          try: () => handle.commit(),
          catch: (cause) => toHostOperationError(cause, "externalSessions.commit"),
        }),
        dispose: Effect.tryPromise({
          try: () => handle.dispose(),
          catch: (cause) => toHostOperationError(cause, "externalSessions.dispose"),
        }),
      })),
    ),
});
