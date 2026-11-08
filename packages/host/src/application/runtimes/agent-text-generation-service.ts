import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { AgentSessionLiveAdapterRegistryPort } from "../../ports/agent-session-live-adapter-port";
import type { AgentTextGenerationPort } from "../../ports/agent-text-generation-port";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";

/** Runs a text generation on the ready runtime of the selected model. */
export const createAgentTextGenerationService = ({
  runtimeRegistry,
  adapterRegistry,
}: {
  runtimeRegistry: Pick<RuntimeRegistryPort, "requireReady">;
  adapterRegistry: Pick<AgentSessionLiveAdapterRegistryPort, "list">;
}): AgentTextGenerationPort => ({
  generate: (input) =>
    Effect.gen(function* () {
      const { runtimeKind } = input.model;
      const runtime = yield* runtimeRegistry.requireReady(runtimeKind);
      const generation = adapterRegistry
        .list()
        .find(
          (candidate) =>
            candidate.binding.runtimeId === runtime.runtimeId &&
            candidate.binding.runtimeKind === runtimeKind,
        )?.textGeneration;
      if (!generation)
        return yield* new HostOperationError({
          operation: "textGeneration.generate",
          message: `${runtime.descriptor.label} cannot generate text. Select a model of another runtime.`,
        });
      return yield* generation.generate(input);
    }),
});
