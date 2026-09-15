import { type RuntimeKind, runtimeKindSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { ProcessEnvironmentError } from "../../infrastructure/process/process-environment";
import type { RuntimeWorkspaceStarterPort } from "../../ports/runtime-registry-port";

export type RuntimeWorkspaceStarters = Record<RuntimeKind, RuntimeWorkspaceStarterPort>;

export const createRuntimeWorkspaceStarterDispatcher = (
  starters: RuntimeWorkspaceStarters,
  processEnvironmentError: ProcessEnvironmentError | null = null,
): RuntimeWorkspaceStarterPort => ({
  startWorkspaceRuntime(input) {
    const runtimeKind = runtimeKindSchema.safeParse(input.runtimeKind);
    if (!runtimeKind.success) {
      return Effect.fail(
        new HostValidationError({
          field: "runtimeKind",
          message: `Unsupported workspace runtime kind '${input.runtimeKind}'.`,
          details: { runtimeKind: input.runtimeKind },
        }),
      );
    }
    if (processEnvironmentError) {
      return Effect.fail(
        new HostOperationError({
          operation: "runtimeWorkspace.resolveEnvironment",
          message: `Failed to start ${runtimeKind.data} runtime because the user PATH is unavailable. ${processEnvironmentError.message}`,
          cause: processEnvironmentError,
          details: {
            runtimeKind: runtimeKind.data,
            reason: processEnvironmentError.reason,
            shell: processEnvironmentError.shell,
          },
        }),
      );
    }
    return starters[runtimeKind.data].startWorkspaceRuntime(input);
  },
});
