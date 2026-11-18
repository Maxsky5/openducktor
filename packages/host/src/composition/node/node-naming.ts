import { Effect } from "effect";
import { createNamingService } from "../../application/naming/naming-service";
import { createAgentTextGenerationService } from "../../application/runtimes/agent-text-generation-service";
import type { AgentTextGenerationPort } from "../../ports/agent-text-generation-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";

type TextGenerationRegistries = Parameters<typeof createAgentTextGenerationService>[0];

/**
 * The one text generation service of the host, and the naming service on top of it. The runtime
 * registries come later in composition, so the service resolves them at first use.
 */
export const createNodeNaming = (
  settingsConfig: Pick<SettingsConfigPort, "readGlobalConfig">,
  registries: () => TextGenerationRegistries,
) => {
  let resolved: AgentTextGenerationPort | undefined;
  const textGeneration: AgentTextGenerationPort = {
    generate: (input) =>
      Effect.suspend(() => {
        resolved ??= createAgentTextGenerationService(registries());
        return resolved.generate(input);
      }),
  };
  return { textGeneration, naming: createNamingService({ settingsConfig, textGeneration }) };
};
