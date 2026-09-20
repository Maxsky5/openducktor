import { z } from "zod";

const agentSessionQuestionOptionSchema = z
  .object({
    label: z.string(),
    description: z.string(),
  })
  .strict();

export const agentSessionQuestionItemSchema = z
  .object({
    header: z.string(),
    question: z.string(),
    options: z.array(agentSessionQuestionOptionSchema),
    multiple: z.boolean().optional(),
    custom: z.boolean().optional(),
  })
  .strict();

export type AgentTranscriptQuestionItem = z.infer<typeof agentSessionQuestionItemSchema>;

export const agentSessionPendingQuestionRequestSchema = z
  .object({
    requestId: z.string(),
    requestInstanceId: z.string().optional(),
    questions: z.array(agentSessionQuestionItemSchema),
    blocking: z.boolean().optional(),
  })
  .strict();
