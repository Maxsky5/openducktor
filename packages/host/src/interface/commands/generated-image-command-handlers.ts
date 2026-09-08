import {
  agentGeneratedImageBatchInputSchema,
  agentGeneratedImageBatchSchema,
  agentGeneratedImageDescribeInputSchema,
} from "@openducktor/contracts";
import { agentGeneratedImageReadInputSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import type { GeneratedImageReadService } from "../../application/agent-sessions/generated-image-read-service";
import { HostValidationError } from "../../effect/host-errors";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";

export const createGeneratedImageCommandHandlers = (service: GeneratedImageReadService) =>
  ({
    agent_session_begin_generated_image_batch: (args) =>
      Effect.try({
        try: () => agentGeneratedImageBatchInputSchema.parse(args),
        catch: () =>
          new HostValidationError({
            field: "args",
            message: "Generated images require an exact session and image identity.",
          }),
      }).pipe(Effect.flatMap(service.beginBatch)),
    agent_session_release_generated_image_batch: (args) =>
      Effect.try({
        try: () => agentGeneratedImageBatchSchema.parse(args),
        catch: () =>
          new HostValidationError({
            field: "args",
            message: "Generated images require an exact session and image identity.",
          }),
      }).pipe(Effect.flatMap(service.releaseBatch)),
    agent_session_describe_generated_images: (args) =>
      Effect.try({
        try: () => agentGeneratedImageDescribeInputSchema.parse(args),
        catch: () =>
          new HostValidationError({
            field: "args",
            message: "Generated images require an exact session and image identity.",
          }),
      }).pipe(Effect.flatMap(service.describe)),
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
