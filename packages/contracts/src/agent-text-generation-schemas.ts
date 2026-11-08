import { z } from "zod";
import { runtimeKindSchema } from "./agent-runtime-schemas";

/**
 * One text generation by a runtime model. The runtime gets no tools and keeps no session, so a
 * generation reads only the instructions and the prompt and changes nothing.
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
