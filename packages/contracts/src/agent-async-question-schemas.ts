import { z } from "zod";

const nonEmptyStringSchema = z.string().trim().min(1);

export const agentAsyncQuestionSchema = z
  .object({
    questionItemId: nonEmptyStringSchema,
    sourceMessageId: nonEmptyStringSchema,
    questionIndex: z.number().int().nonnegative(),
    title: nonEmptyStringSchema,
    options: z.array(nonEmptyStringSchema).nullable(),
  })
  .strict();
export type AgentAsyncQuestion = z.infer<typeof agentAsyncQuestionSchema>;

export const agentAsyncQuestionReplySchema = z
  .object({
    questionItemId: nonEmptyStringSchema,
    question: nonEmptyStringSchema,
    answer: nonEmptyStringSchema,
  })
  .strict();
export type AgentAsyncQuestionReply = z.infer<typeof agentAsyncQuestionReplySchema>;

export const agentAsyncQuestionAnnotationSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("pending"),
      questions: z.array(agentAsyncQuestionSchema).min(1),
    })
    .strict(),
  z
    .object({
      status: z.literal("invalid"),
      error: nonEmptyStringSchema,
    })
    .strict(),
]);
export type AgentAsyncQuestionAnnotation = z.infer<typeof agentAsyncQuestionAnnotationSchema>;
