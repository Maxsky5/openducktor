import type {
  AgentGeneratedImageBatch,
  AgentGeneratedImageBatchResult,
  AgentGeneratedImageBatchInput,
  AgentGeneratedImageDescribeInput,
  AgentGeneratedImageDescribeResult,
  AgentSessionLiveRef,
} from "@openducktor/contracts";
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
  beginBatch(
    input: AgentGeneratedImageBatchInput,
  ): Effect.Effect<AgentGeneratedImageBatchResult, HostError>;
  releaseBatch(input: AgentGeneratedImageBatch): Effect.Effect<void, HostError>;
  describe(
    input: AgentGeneratedImageDescribeInput,
  ): Effect.Effect<AgentGeneratedImageDescribeResult, HostError>;
  read(
    input: AgentGeneratedImageReadInput,
  ): Effect.Effect<AgentGeneratedImageReadResult, HostError>;
};

export const createGeneratedImageReadService = (
  registry: AgentSessionLiveAdapterRegistryPort,
  files: GeneratedImageFilePort,
  definitions: RuntimeDefinitionsService,
): GeneratedImageReadService => {
  const resolve = (ref: AgentSessionLiveRef) =>
    Effect.gen(function* () {
      const descriptor = definitions
        .listRuntimeDefinitions()
        .find((runtime) => runtime.kind === ref.runtimeKind);
      if (!descriptor?.capabilities.optionalSurfaces.supportsImageGeneration)
        return yield* Effect.fail(
          new HostValidationError({
            field: "runtimeKind",
            message: `Runtime '${ref.runtimeKind}' does not support generated image previews.`,
          }),
        );
      return yield* registry.resolveForScope(ref);
    });
  return {
    beginBatch: (input) =>
      Effect.gen(function* () {
        const adapter = yield* resolve(input.ref);
        const batch = yield* adapter.beginGeneratedImageBatch(input);
        if ((yield* registry.resolveForScope(input.ref)) !== adapter) {
          yield* adapter.releaseGeneratedImageBatch(batch);
          return yield* Effect.fail(
            new HostValidationError({
              field: "runtimeKind",
              message: "The image runtime changed. Reopen the session.",
            }),
          );
        }
        return batch;
      }),
    releaseBatch: (input) =>
      Effect.flatMap(resolve(input.ref), (adapter) => adapter.releaseGeneratedImageBatch(input)),
    describe: (input) =>
      Effect.gen(function* () {
        const adapter = yield* resolve(input.ref);
        const result = yield* adapter.describeGeneratedImages(input);
        if ((yield* registry.resolveForScope(input.ref)) !== adapter)
          return yield* Effect.fail(
            new HostValidationError({
              field: "runtimeKind",
              message: "The image runtime changed. Reopen the session.",
            }),
          );
        return result;
      }),
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
  };
};
