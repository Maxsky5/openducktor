import type { RuntimeSessionImportPort as NativePort } from "@openducktor/core";
import { Effect } from "effect";
import { toHostOperationError } from "../../effect/host-errors";
import type { RuntimeSessionImportPort } from "../../ports/runtime-session-import-port";

export const createRuntimeSessionImportAdapter = (
  native: NativePort,
): RuntimeSessionImportPort => ({
  listMetadataPage: (input) =>
    Effect.tryPromise({
      try: () => native.listMetadataPage(input),
      catch: (cause) => toHostOperationError(cause, "sessionImport.listMetadataPage"),
    }),
  getMetadata: (input) =>
    Effect.tryPromise({
      try: () => native.getMetadata(input),
      catch: (cause) => toHostOperationError(cause, "sessionImport.getMetadata"),
    }),
  openForImport: (input) =>
    Effect.tryPromise({
      try: () => native.openForImport(input),
      catch: (cause) => toHostOperationError(cause, "sessionImport.openForImport"),
    }).pipe(
      Effect.map((handle) => ({
        metadata: handle.metadata,
        selectedModel: handle.selectedModel,
        commit: Effect.tryPromise({
          try: () => handle.commit(),
          catch: (cause) => toHostOperationError(cause, "sessionImport.commit"),
        }),
        dispose: Effect.tryPromise({
          try: () => handle.dispose(),
          catch: (cause) => toHostOperationError(cause, "sessionImport.dispose"),
        }),
      })),
    ),
});
