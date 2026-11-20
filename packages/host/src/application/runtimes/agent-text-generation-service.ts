import type { AgentJsonGenerationInput, AgentTextGenerationInput } from "@openducktor/contracts";
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
}): AgentTextGenerationPort => {
  const adapterFor = (input: AgentTextGenerationInput) =>
    Effect.gen(function* () {
      const { runtimeKind } = input.model;
      yield* runtimeRegistry.requireReady(runtimeKind);
      return yield* adapterRegistry.resolveForScope({ repoPath: input.repoPath, runtimeKind });
    });
  return {
    generate: (input) =>
      adapterFor(input).pipe(Effect.flatMap((adapter) => adapter.textGeneration.generate(input))),
    generateJson: <Answer>(input: AgentJsonGenerationInput<Answer>) =>
      adapterFor(input).pipe(
        Effect.flatMap((adapter) => adapter.textGeneration.generateJson(input)),
      ),
  };
};
