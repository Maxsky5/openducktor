import {
  agentGeneratedImageReadResultSchema,
  type AgentGeneratedImageReadInput,
  type AgentGeneratedImageReadResult,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { type HostError, HostValidationError } from "../../effect/host-errors";
import type { AgentSessionLiveAdapterRegistryPort } from "../../ports/agent-session-live-adapter-port";
import type { GeneratedImageFilePort } from "../../ports/generated-image-file-port";
import type { RuntimeDefinitionsService } from "../runtimes/runtime-definitions-service";

export type GeneratedImageReadService = {
  read(
    input: AgentGeneratedImageReadInput,
  ): Effect.Effect<AgentGeneratedImageReadResult, HostError>;
};

export const createGeneratedImageReadService = (
  registry: AgentSessionLiveAdapterRegistryPort,
  files: GeneratedImageFilePort,
  definitions: RuntimeDefinitionsService,
): GeneratedImageReadService => ({
  read: (input) =>
    Effect.gen(function* () {
      const descriptor = definitions
        .listRuntimeDefinitions()
        .find((runtime) => runtime.kind === input.ref.runtimeKind);
      if (!descriptor?.capabilities.optionalSurfaces.supportsImageGeneration)
        return yield* Effect.fail(
          new HostValidationError({
            field: "runtimeKind",
            message: `Runtime '${input.ref.runtimeKind}' does not support generated image previews.`,
            details: { itemId: input.itemId },
          }),
        );
      const adapter = yield* registry.resolveForScope(input.ref);
      const source = yield* adapter.resolveGeneratedImageSource(input);
      if ((yield* registry.resolveForScope(input.ref)) !== adapter)
        return yield* Effect.fail(
          new HostValidationError({
            field: "runtimeKind",
            message: "The image runtime changed during the read. Reopen the session.",
            details: { itemId: input.itemId },
          }),
        );
      const payload = yield* files.read(source, input.itemId);
      if ((yield* registry.resolveForScope(input.ref)) !== adapter)
        return yield* Effect.fail(
          new HostValidationError({
            field: "runtimeKind",
            message: "The image runtime changed during the read. Reopen the session.",
            details: { itemId: input.itemId },
          }),
        );
      return yield* Effect.try({
        try: () => agentGeneratedImageReadResultSchema.parse({ ...input, ...payload }),
        catch: () =>
          new HostValidationError({
            field: "image",
            message: "The generated image reader returned an invalid preview payload.",
            details: { itemId: input.itemId },
          }),
      });
    }),
});
