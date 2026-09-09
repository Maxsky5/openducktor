import { Effect } from "effect";
import type { CodexSessionController } from "./codex-live-session-adapter-contract";
import type { HostOperationErrorAggregate } from "../../effect/host-errors";
import type { AgentSessionRuntimeAdapterPort } from "../../ports/agent-session-live-adapter-port";

export const createCodexImageOperations = (
  controller: CodexSessionController,
  sessionError: (
    operation: string,
    externalSessionId: string,
  ) => (cause: unknown) => HostOperationErrorAggregate,
): Pick<
  AgentSessionRuntimeAdapterPort,
  | "beginGeneratedImageBatch"
  | "releaseGeneratedImageBatch"
  | "describeGeneratedImages"
  | "resolveGeneratedImageSource"
> => ({
  beginGeneratedImageBatch: (input) =>
    Effect.tryPromise({
      try: (signal) => controller.beginGeneratedImageBatch(input, signal),
      catch: sessionError("codex-live-session.begin-image-batch", input.ref.externalSessionId),
    }),
  describeGeneratedImages: (input) =>
    Effect.tryPromise({
      try: (signal) => controller.describeGeneratedImages(input, signal),
      catch: sessionError("codex-live-session.describe-images", input.ref.externalSessionId),
    }),
  releaseGeneratedImageBatch: (input) =>
    Effect.try({
      try: () => controller.releaseGeneratedImageBatch(input),
      catch: sessionError("codex-live-session.release-image-batch", input.ref.externalSessionId),
    }),
  resolveGeneratedImageSource: (input) =>
    Effect.tryPromise({
      try: (signal) => controller.resolveGeneratedImageSource(input, signal),
      catch: sessionError("codex-live-session.read-generated-image", input.ref.externalSessionId),
    }),
});
