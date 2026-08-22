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

// SAFETY: The surrounding boundary constructs or validates every member required by `z.ZodType<AgentTranscriptQuestionItem>`.
export const agentSessionQuestionItemSchema =
  inferredAgentSessionQuestionItemSchema as z.ZodType<AgentTranscriptQuestionItem>;
