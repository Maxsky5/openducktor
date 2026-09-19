import { z } from "zod";

const nonBlankStringSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "String must contain non-whitespace text",
});

export const agentAsyncQuestionSchema = z
  .object({
    questionItemId: nonBlankStringSchema,
    sourceMessageId: nonBlankStringSchema,
    questionIndex: z.number().int().nonnegative(),
    title: nonBlankStringSchema,
    options: z.array(nonBlankStringSchema).min(1).nullable(),
  })
  .strict();
export type AgentAsyncQuestion = z.infer<typeof agentAsyncQuestionSchema>;

export const agentAsyncQuestionReplySchema = z
  .object({
    questionItemId: nonBlankStringSchema,
    question: nonBlankStringSchema,
    answer: nonBlankStringSchema,
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
      error: nonBlankStringSchema,
    })
    .strict(),
]);
export type AgentAsyncQuestionAnnotation = z.infer<typeof agentAsyncQuestionAnnotationSchema>;

export const agentAsyncQuestionMatchesReplyId = (
  question: AgentAsyncQuestion,
  replyId: string,
): boolean => question.questionItemId === replyId || question.sourceMessageId === replyId;
