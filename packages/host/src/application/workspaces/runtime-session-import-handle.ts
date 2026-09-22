import type { WorkspaceSessionImportResult } from "@openducktor/contracts";
import { Cause, Effect, Exit } from "effect";
import { type HostError, HostOperationError } from "../../effect/host-errors";
import type { HostSessionImportHandle } from "../../ports/runtime-session-import-port";

export const withRuntimeSessionImportHandle = (
  acquire: Effect.Effect<HostSessionImportHandle, HostError>,
  use: (handle: HostSessionImportHandle) => Effect.Effect<WorkspaceSessionImportResult, HostError>,
): Effect.Effect<WorkspaceSessionImportResult, HostError> =>
  Effect.uninterruptible(
    Effect.gen(function* () {
      const handle = yield* acquire;
      const result = yield* Effect.exit(use(handle));
      const cleanup = yield* Effect.exit(handle.dispose);
      if (Exit.isSuccess(cleanup)) return yield* result;
      const message = `Import cleanup failed: ${Cause.pretty(cleanup.cause)}`;
      if (Exit.isSuccess(result))
        return {
          ...result.value,
          openError: [result.value.openError, message].filter(Boolean).join("\n"),
        };
      return yield* new HostOperationError({
        operation: "workspaceSessionImport.cleanup",
        message: `${Cause.pretty(result.cause)}\n${message}`,
        cause: { import: result.cause, cleanup: cleanup.cause },
      });
    }),
  );
