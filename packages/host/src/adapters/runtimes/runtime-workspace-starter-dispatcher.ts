import { type RuntimeKind, runtimeKindSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { RuntimeWorkspaceStarterPort } from "../../ports/runtime-registry-port";

export type RuntimeWorkspaceStarters = Record<RuntimeKind, RuntimeWorkspaceStarterPort>;

export const createRuntimeWorkspaceStarterDispatcher = (
  starters: RuntimeWorkspaceStarters,
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
    return starters[runtimeKind.data].startWorkspaceRuntime(input);
  },
});
