import { z } from "zod";
import { exactOptionalSchema } from "./exact-optional";

const agentSessionQuestionOptionSchema = z
  .object({
    label: z.string(),
    description: z.string(),
  })
  .strict();

export const agentSessionQuestionItemSchema = exactOptionalSchema(
  z
    .object({
      header: z.string(),
      question: z.string(),
      options: z.array(agentSessionQuestionOptionSchema),
      multiple: z.boolean().optional(),
      custom: z.boolean().optional(),
    })
    .strict(),
);

export type AgentTranscriptQuestionItem = z.infer<typeof agentSessionQuestionItemSchema>;
