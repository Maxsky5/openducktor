import type { AgentJsonGenerationInput } from "@openducktor/contracts";
import { Effect } from "effect";
import { toHostOperationError } from "../../effect/host-errors";
import type { AgentTextGenerationPort } from "../../ports/agent-text-generation-port";
import type { CodexSessionController } from "./codex-live-session-adapter-contract";

/** Text and JSON generation on the app-server of one Codex runtime. */
export const createCodexTextGeneration = (
  controller: Pick<CodexSessionController, "generateText" | "generateJson">,
  runtimeId: string,
): AgentTextGenerationPort => ({
  generate: (input) =>
    Effect.tryPromise({
      try: (signal) => controller.generateText(runtimeId, input, signal),
      catch: (cause) =>
        toHostOperationError(cause, "codex-live-session.generate-text", { runtimeId }),
    }),
  generateJson: <Answer>(input: AgentJsonGenerationInput<Answer>) =>
    Effect.tryPromise({
      try: (signal) => controller.generateJson(runtimeId, input, signal),
      catch: (cause) =>
        toHostOperationError(cause, "codex-live-session.generate-json", { runtimeId }),
    }),
});
