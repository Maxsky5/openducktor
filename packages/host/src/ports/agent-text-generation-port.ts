import type { AgentJsonGenerationInput, AgentTextGenerationInput } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";

/**
 * One generation by a runtime model, with no saved session and no file changes. The runtime reads
 * the instructions and the prompt, and returns its final answer.
 */
export type AgentTextGenerationPort = {
  /** The final text of the answer. */
  generate(input: AgentTextGenerationInput): Effect.Effect<string, HostError>;
  /**
   * The final answer as one JSON object of `answerSchema`. Codex and Claude constrain the answer
   * to its JSON Schema. OpenCode cannot, so it gets the JSON Schema in the prompt. Each adapter
   * checks the answer with `answerSchema`, and an answer that does not fit fails.
   */
  generateJson<Answer>(input: AgentJsonGenerationInput<Answer>): Effect.Effect<Answer, HostError>;
};
