import { z } from "zod";
import { runtimeKindSchema } from "./agent-runtime-schemas";

/**
 * One text generation by a runtime model. The runtime keeps no session and changes no files.
 * Claude and OpenCode give the model no tools. Codex has no turn without tools, so its thread is
 * read-only, with no environment and no approvals, and it turns off the configured MCP servers,
 * plugins, and apps.
 */
export const agentTextGenerationInputSchema = z.strictObject({
  /** The repository whose runtime and folder the generation uses. */
  repoPath: z.string().min(1),
  model: z.strictObject({
    runtimeKind: runtimeKindSchema,
    providerId: z.string().min(1),
    modelId: z.string().min(1),
    variant: z.string().min(1).optional(),
  }),
  /** What the model must produce and how. */
  instructions: z.string().trim().min(1),
  /** The material that the model works from. */
  prompt: z.string().trim().min(1),
});
export type AgentTextGenerationInput = z.infer<typeof agentTextGenerationInputSchema>;

export const agentTextGenerationResultSchema = z.strictObject({ text: z.string().trim().min(1) });

/** A JSON Schema of an object, as `z.toJSONSchema` writes it for a strict object schema. */
export const agentJsonOutputSchemaSchema = z
  .object({ type: z.literal("object") })
  .catchall(z.json());
export type AgentJsonOutputSchema = z.infer<typeof agentJsonOutputSchemaSchema>;

/**
 * One JSON generation: a text generation whose answer is one JSON object of `answerSchema`. The
 * runtime adapter constrains the answer to the JSON Schema of `answerSchema` when the runtime can,
 * and checks the answer with `answerSchema` before it returns it.
 */
export type AgentJsonGenerationInput<Answer> = AgentTextGenerationInput & {
  answerSchema: z.ZodType<Answer>;
};

/**
 * The JSON Schema that constrains the answer of a JSON generation. It uses draft-07, because the
 * Claude CLI checks `--json-schema` with draft-07 and rejects the draft 2020-12 meta-schema.
 */
export const agentJsonOutputSchema = (answerSchema: z.ZodType): AgentJsonOutputSchema =>
  agentJsonOutputSchemaSchema.parse(z.toJSONSchema(answerSchema, { target: "draft-07" }));

/** The error of a runtime answer that does not fit the answer schema of its JSON generation. */
export const agentJsonAnswerMismatch = (runtime: string, error: z.ZodError): Error =>
  new Error(
    `${runtime} returned an answer that does not fit the output schema: ${z.prettifyError(error)}`,
  );

/**
 * The instructions of a JSON generation on a runtime that cannot constrain the answer to a JSON
 * Schema. The JSON Schema of the answer goes into the instructions as text.
 */
export const agentJsonSchemaInstructions = <Answer>(
  input: AgentJsonGenerationInput<Answer>,
): string =>
  `${input.instructions}\n\nReturn only one JSON object that matches this JSON Schema, with no Markdown or other text:\n${JSON.stringify(agentJsonOutputSchema(input.answerSchema))}`;

/**
 * The answer of `answerSchema` in the answer text of a runtime that cannot constrain the answer.
 * A model can wrap the JSON object in a Markdown code fence or add a sentence, so the object is
 * the text from the first `{` to the last `}`.
 */
export const readAgentJsonAnswer = <Answer>(
  runtime: string,
  text: string,
  answerSchema: z.ZodType<Answer>,
): Answer => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start)
    throw new Error(`${runtime} returned no JSON object for the output schema: ${text}`);
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch (cause) {
    throw new Error(`${runtime} returned a JSON object that does not parse: ${text}`, { cause });
  }
  const answer = answerSchema.safeParse(value);
  if (!answer.success) throw agentJsonAnswerMismatch(runtime, answer.error);
  return answer.data;
};
