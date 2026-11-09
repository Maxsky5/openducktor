import { Effect } from "effect";
import type { AgentSessionLiveAdapterRegistryPort } from "../../ports/agent-session-live-adapter-port";
import type { AgentTextGenerationPort } from "../../ports/agent-text-generation-port";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";

/** Runs a text generation on the ready runtime of the selected model. */
export const createAgentTextGenerationService = ({
  runtimeRegistry,
  adapterRegistry,
}: {
  runtimeRegistry: Pick<RuntimeRegistryPort, "requireReady">;
  adapterRegistry: Pick<AgentSessionLiveAdapterRegistryPort, "resolveForScope">;
}): AgentTextGenerationPort => ({
  generate: (input) =>
    Effect.gen(function* () {
      const { runtimeKind } = input.model;
      yield* runtimeRegistry.requireReady(runtimeKind);
      const adapter = yield* adapterRegistry.resolveForScope({
        repoPath: input.repoPath,
        runtimeKind,
      });
      return yield* adapter.textGeneration.generate(input);
    }),
});
