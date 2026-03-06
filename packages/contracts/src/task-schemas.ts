import { z } from "zod";

export const taskStatusSchema = z.enum([
  "open",
  "spec_ready",
  "ready_for_dev",
  "in_progress",
  "blocked",
  "ai_review",
  "human_review",
  "deferred",
  "closed",
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const issueTypeSchema = z.enum(["task", "feature", "bug", "epic"]);
export type IssueType = z.infer<typeof issueTypeSchema>;

export const taskActionSchema = z.enum([
  "view_details",
  "set_spec",
  "set_plan",
  "build_start",
  "open_builder",
  "defer_issue",
  "resume_deferred",
  "human_request_changes",
  "human_approve",
]);
export type TaskAction = z.infer<typeof taskActionSchema>;

export const taskPrioritySchema = z.number().int().min(0).max(4);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

const taskDocumentPresenceSchema = z.object({
  has: z.boolean().default(false),
  updatedAt: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
});
export type TaskDocumentPresence = z.infer<typeof taskDocumentPresenceSchema>;

export const qaWorkflowVerdictSchema = z.enum(["approved", "rejected", "not_reviewed"]);
export type QaWorkflowVerdict = z.infer<typeof qaWorkflowVerdictSchema>;

const taskQaDocumentPresenceSchema = taskDocumentPresenceSchema.extend({
  verdict: qaWorkflowVerdictSchema.default("not_reviewed"),
});
export type TaskQaDocumentPresence = z.infer<typeof taskQaDocumentPresenceSchema>;

const EMPTY_TASK_DOCUMENT_PRESENCE: TaskDocumentPresence = {
  has: false,
};

const taskDocumentSummarySchema = z.object({
  spec: taskDocumentPresenceSchema.default(EMPTY_TASK_DOCUMENT_PRESENCE),
  plan: taskDocumentPresenceSchema.default(EMPTY_TASK_DOCUMENT_PRESENCE),
  qaReport: taskQaDocumentPresenceSchema.default({
    ...EMPTY_TASK_DOCUMENT_PRESENCE,
    verdict: "not_reviewed",
  }),
});
export type TaskDocumentSummary = z.infer<typeof taskDocumentSummarySchema>;

const EMPTY_TASK_DOCUMENT_SUMMARY: TaskDocumentSummary = {
  spec: EMPTY_TASK_DOCUMENT_PRESENCE,
  plan: EMPTY_TASK_DOCUMENT_PRESENCE,
  qaReport: {
    ...EMPTY_TASK_DOCUMENT_PRESENCE,
    verdict: "not_reviewed",
  },
};

const agentWorkflowStateSchema = z.object({
  required: z.boolean().default(false),
  canSkip: z.boolean().default(true),
  available: z.boolean().default(false),
  completed: z.boolean().default(false),
});
export type AgentWorkflowState = z.infer<typeof agentWorkflowStateSchema>;

const agentWorkflowsSchema = z.object({
  spec: agentWorkflowStateSchema.default({
    required: false,
    canSkip: true,
    available: false,
    completed: false,
  }),
  planner: agentWorkflowStateSchema.default({
    required: false,
    canSkip: true,
    available: false,
    completed: false,
  }),
  builder: agentWorkflowStateSchema.default({
    required: true,
    canSkip: false,
    available: false,
    completed: false,
  }),
  qa: agentWorkflowStateSchema.default({
    required: false,
    canSkip: true,
    available: false,
    completed: false,
  }),
});
export type AgentWorkflows = z.infer<typeof agentWorkflowsSchema>;

const EMPTY_AGENT_WORKFLOWS: AgentWorkflows = {
  spec: {
    required: false,
    canSkip: true,
    available: false,
    completed: false,
  },
  planner: {
    required: false,
    canSkip: true,
    available: false,
    completed: false,
  },
  builder: {
    required: true,
    canSkip: false,
    available: false,
    completed: false,
  },
  qa: {
    required: false,
    canSkip: true,
    available: false,
    completed: false,
  },
};

export const taskCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional().default(""),
  acceptanceCriteria: z.string().optional().default(""),
  notes: z.string().optional().default(""),
  status: taskStatusSchema,
  priority: taskPrioritySchema.default(2),
  issueType: issueTypeSchema,
  aiReviewEnabled: z.boolean().optional().default(true),
  availableActions: z.array(taskActionSchema).default([]),
  labels: z.array(z.string()).default([]),
  assignee: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  parentId: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  subtaskIds: z.array(z.string()).default([]),
  documentSummary: taskDocumentSummarySchema.optional().default(EMPTY_TASK_DOCUMENT_SUMMARY),
  agentWorkflows: agentWorkflowsSchema.optional().default(EMPTY_AGENT_WORKFLOWS),
  updatedAt: z.string(),
  createdAt: z.string(),
});
export type TaskCard = z.infer<typeof taskCardSchema>;

export const taskCreateInputSchema = z.object({
  title: z.string().min(1),
  issueType: issueTypeSchema.default("task"),
  aiReviewEnabled: z.boolean().optional().default(true),
  priority: taskPrioritySchema.default(2),
  description: z.string().optional(),
  acceptanceCriteria: z.string().optional(),
  labels: z.array(z.string()).optional(),
  parentId: z.string().optional(),
});
export type TaskCreateInput = z.infer<typeof taskCreateInputSchema>;

export const taskUpdatePatchSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  acceptanceCriteria: z.string().optional(),
  notes: z.string().optional(),
  priority: taskPrioritySchema.optional(),
  issueType: issueTypeSchema.optional(),
  aiReviewEnabled: z.boolean().optional(),
  labels: z.array(z.string()).optional(),
  assignee: z.string().optional(),
  parentId: z.string().optional(),
});
export type TaskUpdatePatch = z.infer<typeof taskUpdatePatchSchema>;
