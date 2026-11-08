import type { AgentTextGenerationInput } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";

/**
 * One text generation by a runtime model, with no tools and no saved session. The runtime reads
 * the instructions and the prompt, and returns its final text.
 */
export type AgentTextGenerationPort = {
  generate(input: AgentTextGenerationInput): Effect.Effect<string, HostError>;
};
