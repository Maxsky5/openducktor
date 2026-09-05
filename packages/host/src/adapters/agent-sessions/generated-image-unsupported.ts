import type { AgentGeneratedImageReadInput } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";

export const unsupportedGeneratedImageSource = (input: AgentGeneratedImageReadInput) =>
  Effect.fail(
    new HostValidationError({
      field: "runtimeKind",
      message: `Runtime '${input.ref.runtimeKind}' does not support generated image previews. Open the output in its runtime.`,
      details: { itemId: input.itemId, runtimeKind: input.ref.runtimeKind },
    }),
  );
