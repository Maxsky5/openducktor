import {
  type AgentToolName,
  issueTypeSchema,
  knownGitProviderIdSchema,
  planSubtaskInputSchema,
  taskPrioritySchema,
} from "@openducktor/contracts";
import { z } from "zod";

export const ReadTaskInputSchema = z
  .object({
    taskId: z.string().trim().min(1),
  })
  .strict();

const publicIssueTypeSchema = z.enum(["task", "feature", "bug"]);
const activeTaskStatusSchema = z.enum([
  "open",
  "spec_ready",
  "ready_for_dev",
  "in_progress",
  "blocked",
  "ai_review",
  "human_review",
]);
const labelStringSchema = z.string().trim().min(1);

export const SetSpecInputSchema = z
  .object({
    taskId: z.string().trim().min(1),
    markdown: z.string().trim().min(1),
  })
  .strict();

export const SetPlanInputSchema = z
  .object({
    taskId: z.string().trim().min(1),
    markdown: z.string().trim().min(1),
    subtasks: z.array(planSubtaskInputSchema.strict()).optional(),
  })
  .strict();

export const BuildBlockedInputSchema = z
  .object({
    taskId: z.string().trim().min(1),
    reason: z.string().trim().min(1),
  })
  .strict();

export const BuildResumedInputSchema = z
  .object({
    taskId: z.string().trim().min(1),
  })
  .strict();

export const BuildCompletedInputSchema = z
  .object({
    taskId: z.string().trim().min(1),
    summary: z.string().optional(),
  })
  .strict();

export const SetPullRequestInputSchema = z
  .object({
    taskId: z.string().trim().min(1),
    providerId: knownGitProviderIdSchema,
    number: z.number().int().positive(),
  })
  .strict();

export const QaApprovedInputSchema = z
  .object({
    taskId: z.string().trim().min(1),
    reportMarkdown: z.string().trim().min(1),
  })
  .strict();

export const QaRejectedInputSchema = z
  .object({
    taskId: z.string().trim().min(1),
    reportMarkdown: z.string().trim().min(1),
  })
  .strict();

export const CreateTaskInputSchema = z
  .object({
    title: z.string().trim().min(1).describe("Task title."),
    issueType: publicIssueTypeSchema.describe(
      "Issue type. Allowed values: task, feature, bug. Epic is not supported by the public MCP create tool.",
    ),
    priority: taskPrioritySchema.describe(
      "Task priority. Valid values: 0 (P0 Critical), 1 (P1 High), 2 (P2 Normal), 3 (P3 Low), 4 (P4 Very low).",
    ),
    description: z.string().trim().min(1).optional().describe("Optional task description."),
    labels: z.array(labelStringSchema).optional().describe("Optional task labels."),
    aiReviewEnabled: z
      .boolean()
      .optional()
      .describe("Optional override for whether OpenDucktor QA review is required."),
  })
  .strict();

export const SearchTasksInputSchema = z
  .object({
    priority: taskPrioritySchema.optional().describe("Exact-match priority filter."),
    issueType: issueTypeSchema
      .optional()
      .describe("Exact-match issue type filter. Active epics may appear in search results."),
    status: activeTaskStatusSchema.optional().describe("Exact-match active status filter."),
    title: z.string().trim().min(1).optional().describe("Case-insensitive title substring filter."),
    tags: z
      .array(labelStringSchema)
      .min(1)
      .optional()
      .describe("Task labels filter. Matching tasks must contain all tags."),
    limit: z
      .number()
      .int()
      .positive()
      .max(100)
      .default(50)
      .describe("Maximum number of results to return. Default 50, max 100."),
  })
  .strict();

export type ReadTaskInput = z.infer<typeof ReadTaskInputSchema>;
export type SetSpecInput = z.infer<typeof SetSpecInputSchema>;
export type SetPlanInput = z.infer<typeof SetPlanInputSchema>;
export type BuildBlockedInput = z.infer<typeof BuildBlockedInputSchema>;
export type BuildResumedInput = z.infer<typeof BuildResumedInputSchema>;
export type BuildCompletedInput = z.infer<typeof BuildCompletedInputSchema>;
export type SetPullRequestInput = z.infer<typeof SetPullRequestInputSchema>;
export type QaApprovedInput = z.infer<typeof QaApprovedInputSchema>;
export type QaRejectedInput = z.infer<typeof QaRejectedInputSchema>;
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;
export type SearchTasksInput = z.infer<typeof SearchTasksInputSchema>;

const ODT_WORKFLOW_TOOL_SCHEMAS = {
  odt_read_task: ReadTaskInputSchema,
  odt_set_spec: SetSpecInputSchema,
  odt_set_plan: SetPlanInputSchema,
  odt_build_blocked: BuildBlockedInputSchema,
  odt_build_resumed: BuildResumedInputSchema,
  odt_build_completed: BuildCompletedInputSchema,
  odt_set_pull_request: SetPullRequestInputSchema,
  odt_qa_approved: QaApprovedInputSchema,
  odt_qa_rejected: QaRejectedInputSchema,
} as const satisfies Record<AgentToolName, z.ZodTypeAny>;

export const ODT_TOOL_SCHEMAS = {
  ...ODT_WORKFLOW_TOOL_SCHEMAS,
  create_task: CreateTaskInputSchema,
  search_tasks: SearchTasksInputSchema,
} as const;
