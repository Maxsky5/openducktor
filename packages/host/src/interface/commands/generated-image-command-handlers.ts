import { agentGeneratedImageReadInputSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import type { GeneratedImageReadService } from "../../application/agent-sessions/generated-image-read-service";
import { HostValidationError } from "../../effect/host-errors";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";

export const createGeneratedImageCommandHandlers = (service: GeneratedImageReadService) =>
  ({
    agent_session_read_generated_image: (args) =>
      Effect.try({
        try: () => agentGeneratedImageReadInputSchema.parse(args),
        catch: () =>
          new HostValidationError({
            field: "args",
            message:
              "Generated image reads require an exact session, item identity, and output revision. Paths, URLs, and image bytes are not accepted.",
          }),
      }).pipe(Effect.flatMap(service.read)),
  }) satisfies HostCommandHandlerDefinitions;
