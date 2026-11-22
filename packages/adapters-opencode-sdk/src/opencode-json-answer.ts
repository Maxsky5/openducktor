import {
  type AgentJsonGenerationInput,
  agentJsonSchemaInstructions,
  readAgentJsonAnswer,
} from "@openducktor/contracts";
import type { z } from "zod";

/**
 * The instructions of a JSON generation on OpenCode. `generate.text` has no output schema option
 * (`@opencode/client` 2.2.5 to 2.3.2), so the JSON Schema of the answer goes into the
 * instructions as text.
 */
export const openCodeJsonInstructions = <Answer>(input: AgentJsonGenerationInput<Answer>): string =>
  agentJsonSchemaInstructions(input);

/** The answer of `answerSchema` in an OpenCode answer text. */
export const readOpenCodeJsonAnswer = <Answer>(
  text: string,
  answerSchema: z.ZodType<Answer>,
): Answer => readAgentJsonAnswer("OpenCode", text, answerSchema);
