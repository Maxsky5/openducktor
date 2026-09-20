import { z } from "zod";

export const agentPendingRequestIdSchema = z.string().trim().min(1);

const agentSessionQuestionOptionSchema = z
  .object({
    label: z.string(),
    description: z.string(),
  })
  .strict();

const agentSessionQuestionItemSchema = z
  .object({
    header: z.string(),
    question: z.string(),
    options: z.array(agentSessionQuestionOptionSchema),
    multiple: z.boolean().optional(),
    custom: z.boolean().optional(),
  })
  .strict();

export type AgentTranscriptQuestionItem = z.infer<typeof agentSessionQuestionItemSchema>;

export const agentSessionPendingQuestionRequestFields = {
  requestId: agentPendingRequestIdSchema,
  requestInstanceId: z.string().optional(),
  questions: z.array(agentSessionQuestionItemSchema),
  blocking: z.boolean().optional(),
};

export const agentSessionPendingQuestionRequestSchema = z
  .object(agentSessionPendingQuestionRequestFields)
  .strict();
