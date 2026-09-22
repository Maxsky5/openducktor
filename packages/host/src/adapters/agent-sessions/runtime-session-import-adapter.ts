import type { RuntimeSessionImportPort as NativePort } from "@openducktor/core";
import { Effect } from "effect";
import { toHostOperationError } from "../../effect/host-errors";
import type { RuntimeSessionImportPort } from "../../ports/runtime-session-import-port";

export const createRuntimeSessionImportAdapter = (
  native: NativePort,
): RuntimeSessionImportPort => ({
  listRootSessionMetadataPage: (input) =>
    Effect.tryPromise({
      try: () => native.listRootSessionMetadataPage(input),
      catch: (cause) => toHostOperationError(cause, "sessionImport.listRootSessionMetadataPage"),
    }),
  verifyImportSource: (input) =>
    Effect.tryPromise({
      try: () => native.verifyImportSource(input),
      catch: (cause) => toHostOperationError(cause, "sessionImport.verifyImportSource"),
    }),
  openExistingSessionForImport: (input) =>
    Effect.tryPromise({
      try: () => native.openExistingSessionForImport(input),
      catch: (cause) => toHostOperationError(cause, "sessionImport.openExistingSessionForImport"),
    }).pipe(
      Effect.map((handle) => ({
        metadata: handle.metadata,
        selectedModel: handle.selectedModel,
        registerLiveSession: Effect.tryPromise({
          try: () => handle.registerLiveSession(),
          catch: (cause) => toHostOperationError(cause, "sessionImport.registerLiveSession"),
        }),
        releaseImportResources: Effect.tryPromise({
          try: () => handle.releaseImportResources(),
          catch: (cause) => toHostOperationError(cause, "sessionImport.releaseImportResources"),
        }),
      })),
    ),
});
