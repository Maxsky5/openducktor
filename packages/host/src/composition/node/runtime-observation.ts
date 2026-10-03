import { Effect } from "effect";
import type { RuntimeInstanceSummary } from "@openducktor/contracts";
import type { AgentSessionLiveAdapterRegistryPort } from "../../ports/agent-session-live-adapter-port";
import { HostOperationError } from "../../effect/host-errors";

export const createRuntimeObservationRequirement =
  (registry: AgentSessionLiveAdapterRegistryPort) =>
  (runtime: RuntimeInstanceSummary): Effect.Effect<void, HostOperationError> =>
    registry.resolveForScope({ repoPath: runtime.repoPath, runtimeKind: runtime.kind }).pipe(
      Effect.flatMap((adapter) =>
        adapter.binding.runtimeId === runtime.runtimeId
          ? Effect.void
          : Effect.fail(
              new HostOperationError({
                operation: "runtime.observe",
                message: "Runtime observation belongs to a previous process.",
              }),
            ),
      ),
      Effect.mapError(
        (cause) =>
          new HostOperationError({
            operation: "runtime.observe",
            message: `Runtime observation is unavailable: ${cause.message} Stop then start the assigned runtime from the runtime controls to restore observation.`,
            cause,
          }),
      ),
    );
