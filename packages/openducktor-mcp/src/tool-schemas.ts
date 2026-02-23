import { z } from "zod";

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
  subtasks: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        issueType: z.enum(["task", "feature", "bug"]).optional(),
        priority: z.number().int().min(0).max(4).optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
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
} as const;
