import { type AgentToolName, issueTypeSchema } from "@openducktor/contracts";
import { z } from "zod";

const PLAN_SUBTASK_PRIORITY_VALUES = [0, 1, 2, 3, 4] as const;
const PlanSubtaskPrioritySchema = z
  .union([
    z.literal(PLAN_SUBTASK_PRIORITY_VALUES[0]),
    z.literal(PLAN_SUBTASK_PRIORITY_VALUES[1]),
    z.literal(PLAN_SUBTASK_PRIORITY_VALUES[2]),
    z.literal(PLAN_SUBTASK_PRIORITY_VALUES[3]),
    z.literal(PLAN_SUBTASK_PRIORITY_VALUES[4]),
  ])
  .describe("Subtask priority. Valid values: 0, 1, 2, 3, 4. Default is 2.");

const PlanSubtaskSchema = z.object({
  title: z.string().trim().min(1),
  issueType: issueTypeSchema
    .refine((value) => value !== "epic", "Epic subtasks are not allowed.")
    .optional(),
  priority: PlanSubtaskPrioritySchema.optional(),
  description: z.string().optional(),
});

export const ReadTaskInputSchema = z.object({
  taskId: z.string().trim().min(1),
});

export const SetSpecInputSchema = z.object({
  taskId: z.string().trim().min(1),
  markdown: z.string().trim().min(1),
});

export const SetPlanInputSchema = z.object({
  taskId: z.string().trim().min(1),
  markdown: z.string().trim().min(1),
  subtasks: z.array(PlanSubtaskSchema).optional(),
});

export const BuildBlockedInputSchema = z.object({
  taskId: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});

export const BuildResumedInputSchema = z.object({
  taskId: z.string().trim().min(1),
});

export const BuildCompletedInputSchema = z.object({
  taskId: z.string().trim().min(1),
  summary: z.string().optional(),
});

export const QaApprovedInputSchema = z.object({
  taskId: z.string().trim().min(1),
  reportMarkdown: z.string().trim().min(1),
});

export const QaRejectedInputSchema = z.object({
  taskId: z.string().trim().min(1),
  reportMarkdown: z.string().trim().min(1),
});

export type ReadTaskInput = z.infer<typeof ReadTaskInputSchema>;
export type SetSpecInput = z.infer<typeof SetSpecInputSchema>;
export type SetPlanInput = z.infer<typeof SetPlanInputSchema>;
export type BuildBlockedInput = z.infer<typeof BuildBlockedInputSchema>;
export type BuildResumedInput = z.infer<typeof BuildResumedInputSchema>;
export type BuildCompletedInput = z.infer<typeof BuildCompletedInputSchema>;
export type QaApprovedInput = z.infer<typeof QaApprovedInputSchema>;
export type QaRejectedInput = z.infer<typeof QaRejectedInputSchema>;

export const ODT_TOOL_SCHEMAS = {
  odt_read_task: ReadTaskInputSchema,
  odt_set_spec: SetSpecInputSchema,
  odt_set_plan: SetPlanInputSchema,
  odt_build_blocked: BuildBlockedInputSchema,
  odt_build_resumed: BuildResumedInputSchema,
  odt_build_completed: BuildCompletedInputSchema,
  odt_qa_approved: QaApprovedInputSchema,
  odt_qa_rejected: QaRejectedInputSchema,
} as const satisfies Record<AgentToolName, z.ZodTypeAny>;
