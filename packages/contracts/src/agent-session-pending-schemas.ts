import { z } from "zod";

export const agentPendingRequestIdSchema = z.string().trim().min(1);

const agentSessionQuestionOptionSchema = z
  .object({
    label: z.string(),
    description: z.string(),
    value: z.string().optional(),
  })
  .strict();

const agentSessionQuestionItemSchema = z
  .object({
    header: z.string(),
    question: z.string(),
    options: z.array(agentSessionQuestionOptionSchema),
    multiple: z.boolean().optional(),
    custom: z.boolean().optional(),
    required: z.boolean().optional(),
    /** The answer is private, such as a password: clients mask it while the user types it. */
    secret: z.boolean().optional(),
  })
  .strict();

export const agentSessionPendingQuestionRequestFields = {
  requestId: agentPendingRequestIdSchema,
  requestInstanceId: z.string().optional(),
  questions: z.array(agentSessionQuestionItemSchema),
  blocking: z.boolean().optional(),
  canCancel: z.boolean().optional(),
  unsupportedReason: z.string().optional(),
};

export const projectApprovalGrantSchema = z.strictObject({
  scope: z.literal("project"),
  projectDirectory: z.string().min(1),
  rules: z.array(z.strictObject({ action: z.string(), resource: z.string() })).optional(),
});

export const agentSessionPendingQuestionRequestSchema = z
  .object(agentSessionPendingQuestionRequestFields)
  .strict();
