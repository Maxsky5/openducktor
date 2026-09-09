import { createGeneratedImageReadService } from "../../application/agent-sessions/generated-image-read-service";
import type { RuntimeDefinitionsService } from "../../application/runtimes/runtime-definitions-service";
import { createGeneratedImageCommandHandlers } from "../../interface/commands/generated-image-command-handlers";
import type { AgentSessionLiveAdapterRegistryPort } from "../../ports/agent-session-live-adapter-port";
import type { GeneratedImageFilePort } from "../../ports/generated-image-file-port";

export const createNodeImageCommandHandlers = (
  registry: AgentSessionLiveAdapterRegistryPort,
  files: GeneratedImageFilePort,
  definitions: RuntimeDefinitionsService,
) =>
  createGeneratedImageCommandHandlers(
    createGeneratedImageReadService(registry, files, definitions),
  );
