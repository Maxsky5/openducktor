import { Effect } from "effect";
import { HostValidationError, toHostOperationError } from "../../effect/host-errors";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";

export const requireLiveClaudeWorkspaceRuntime = (
  runtimeRegistry: RuntimeRegistryPort,
  input: { repoPath: string; runtimeKind: string },
) =>
  Effect.gen(function* () {
    const runtime = yield* runtimeRegistry
      .findWorkspaceRuntime({
        repoPath: input.repoPath,
        runtimeKind: input.runtimeKind,
      })
      .pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "claudeRuntime.findWorkspaceRuntime", {
            repoPath: input.repoPath,
            runtimeKind: input.runtimeKind,
          }),
        ),
      );
    if (!runtime) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "runtimeKind",
          message: `No live Claude workspace runtime found for repo '${input.repoPath}'.`,
          details: { repoPath: input.repoPath, runtimeKind: input.runtimeKind },
        }),
      );
    }
    return runtime;
  });
