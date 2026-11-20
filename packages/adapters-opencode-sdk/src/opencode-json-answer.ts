import {
  agentJsonAnswerMismatch,
  agentJsonOutputSchema,
  type AgentJsonGenerationInput,
} from "@openducktor/contracts";
import type { z } from "zod";

/**
 * The instructions of a JSON generation on OpenCode. `generate.text` has no output schema option
 * (`@opencode/client` 2.2.5 to 2.3.2), so the JSON Schema of the answer goes into the
 * instructions as text.
 */
export const openCodeJsonInstructions = <Answer>(input: AgentJsonGenerationInput<Answer>): string =>
  `${input.instructions}\n\nReturn only one JSON object that matches this JSON Schema, with no Markdown or other text:\n${JSON.stringify(agentJsonOutputSchema(input.answerSchema))}`;

/**
 * The answer of `answerSchema` in an answer text. A model without an output schema can wrap the
 * JSON object in a Markdown code fence or add a sentence, so the object is the text from the first
 * `{` to the last `}`.
 */
export const readOpenCodeJsonAnswer = <Answer>(
  text: string,
  answerSchema: z.ZodType<Answer>,
): Answer => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start)
    throw new Error(`OpenCode returned no JSON object for the output schema: ${text}`);
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch (cause) {
    throw new Error(`OpenCode returned a JSON object that does not parse: ${text}`, { cause });
  }
  const answer = answerSchema.safeParse(value);
  if (!answer.success) throw agentJsonAnswerMismatch("OpenCode", answer.error);
  return answer.data;
};
