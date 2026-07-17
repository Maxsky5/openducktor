import { z } from "zod";

const agentSessionQuestionOptionSchema = z
  .object({
    label: z.string(),
    description: z.string(),
  })
  .strict();

export type AgentTranscriptQuestionItem = {
  header: string;
  question: string;
  options: Array<{ label: string; description: string }>;
  multiple?: boolean;
  custom?: boolean;
};

const inferredAgentSessionQuestionItemSchema = z
  .object({
    header: z.string(),
    question: z.string(),
    options: z.array(agentSessionQuestionOptionSchema),
    multiple: z.boolean().optional(),
    custom: z.boolean().optional(),
  })
  .strict();

export const agentSessionQuestionItemSchema =
  inferredAgentSessionQuestionItemSchema as unknown as z.ZodType<AgentTranscriptQuestionItem>;
