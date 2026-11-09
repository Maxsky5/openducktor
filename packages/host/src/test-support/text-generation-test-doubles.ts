import { Effect } from "effect";
import type { AgentTextGenerationPort } from "../ports/agent-text-generation-port";

export const unexpectedTextGeneration: AgentTextGenerationPort = {
  generate: () => Effect.die(new Error("Unexpected text generation")),
};
