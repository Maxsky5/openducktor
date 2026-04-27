import { z } from "zod";
import {
  gitTargetBranchSchema,
  knownGitProviderIdSchema,
  pullRequestSchema,
  workspaceRecordSchema,
} from "./git-schemas";
import {
  type ODT_MCP_TOOL_NAMES,
  ODT_TOOL_NAMES,
  ODT_WORKFLOW_AGENT_BLOCKED_TOOL_NAMES,
  ODT_WORKFLOW_AGENT_TOOL_NAMES,
  ODT_WORKSPACE_DISCOVERY_TOOL_NAME,
} from "./odt-tool-names";
import {
  issueTypeSchema,
  planSubtaskInputSchema,
  qaWorkflowVerdictSchema,
  taskPrioritySchema,
  taskStatusSchema,
} from "./task-schemas";

export const odtToolErrorCodeSchema = z.enum([
  "ODT_TOOL_INPUT_INVALID",
  "ODT_WORKSPACE_SCOPE_VIOLATION",
  "ODT_WORKSPACE_MISSING",
  "ODT_HOST_BRIDGE_ERROR",
  "ODT_HOST_RESPONSE_INVALID",
  "ODT_TOOL_EXECUTION_ERROR",
]);
export type OdtToolErrorCode = z.infer<typeof odtToolErrorCodeSchema>;

export const odtToolErrorIssueSchema = z
  .object({
    path: z.array(z.union([z.string(), z.number()])),
    message: z.string(),
    code: z.string(),
  })
  .strict();
export type OdtToolErrorIssue = z.infer<typeof odtToolErrorIssueSchema>;

export const odtToolErrorSchema = z
  .object({
    code: odtToolErrorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    issues: z.array(odtToolErrorIssueSchema).optional(),
  })
  .strict();
export type OdtToolErrorPayloadError = z.infer<typeof odtToolErrorSchema>;

export const odtToolErrorPayloadSchema = z
  .object({
    ok: z.literal(false),
    error: odtToolErrorSchema,
  })
  .strict();
export type OdtToolErrorPayload = z.infer<typeof odtToolErrorPayloadSchema>;

export const publicTaskSchema = z
  .object({
    id: z.string().trim().min(1).describe("Canonical task identifier."),
    title: z.string().describe("Task title."),
    description: z.string().describe("Task description. Empty string when omitted."),
    status: taskStatusSchema.describe("Current task status."),
    priority: taskPrioritySchema.describe(
      "Task priority. Valid values: 0 (P0 Critical), 1 (P1 High), 2 (P2 Normal), 3 (P3 Low), 4 (P4 Very low).",
    ),
    issueType: issueTypeSchema.describe("Task issue type."),
    aiReviewEnabled: z
      .boolean()
      .describe("Whether OpenDucktor QA review is required before human review."),
    labels: z.array(z.string()).describe("Task labels."),
    targetBranch: gitTargetBranchSchema
      .optional()
      .describe("Persisted task target branch override."),
    createdAt: z.string().describe("Task creation timestamp."),
    updatedAt: z.string().describe("Task last update timestamp."),
  })
  .strict();
export type PublicTask = z.infer<typeof publicTaskSchema>;

export const taskDocumentPresenceSchema = z
  .object({
    hasSpec: z.boolean(),
    hasPlan: z.boolean(),
    hasQaReport: z.boolean(),
  })
  .strict();
export type PublicTaskDocumentPresence = z.infer<typeof taskDocumentPresenceSchema>;

export const publicTaskSummaryTaskSchema = publicTaskSchema
  .extend({
    qaVerdict: qaWorkflowVerdictSchema,
    documents: taskDocumentPresenceSchema,
  })
  .strict();
export type PublicTaskSummaryTask = z.infer<typeof publicTaskSummaryTaskSchema>;

export const taskSummarySchema = z
  .object({
    task: publicTaskSummaryTaskSchema,
  })
  .strict();
export type TaskSummary = z.infer<typeof taskSummarySchema>;

const markdownTaskDocumentSchema = z
  .object({
    markdown: z.string(),
    updatedAt: z.string().nullable(),
    error: z.string().optional(),
  })
  .strict();

const latestQaReportSchema = z
  .object({
    markdown: z.string(),
    updatedAt: z.string().nullable(),
    verdict: qaWorkflowVerdictSchema,
    error: z.string().optional(),
  })
  .strict();

export const taskRequestedDocumentsSchema = z
  .object({
    spec: markdownTaskDocumentSchema.optional(),
    implementationPlan: markdownTaskDocumentSchema.optional(),
    latestQaReport: latestQaReportSchema.optional(),
  })
  .strict();
export type TaskRequestedDocuments = z.infer<typeof taskRequestedDocumentsSchema>;

export const taskDocumentsReadSchema = z
  .object({
    documents: taskRequestedDocumentsSchema,
  })
  .strict();
export type TaskDocumentsRead = z.infer<typeof taskDocumentsReadSchema>;

const workspaceScopedToolWorkspaceIdSchema = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe("Optional workspaceId. Overrides startup workspace; workflow agents omit.");

export const ReadTaskInputSchema = z
  .object({
    workspaceId: workspaceScopedToolWorkspaceIdSchema,
    taskId: z.string().trim().min(1),
  })
  .strict();
export type ReadTaskInput = z.infer<typeof ReadTaskInputSchema>;

export const ReadTaskDocumentsInputSchema = z
  .object({
    workspaceId: workspaceScopedToolWorkspaceIdSchema,
    taskId: z.string().trim().min(1),
    includeSpec: z.boolean().optional(),
    includePlan: z.boolean().optional(),
    includeQaReport: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.includeSpec || value.includePlan || value.includeQaReport) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "At least one document include flag must be true. Set includeSpec, includePlan, or includeQaReport.",
      path: [],
    });
  });
export type ReadTaskDocumentsInput = z.infer<typeof ReadTaskDocumentsInputSchema>;

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
    workspaceId: workspaceScopedToolWorkspaceIdSchema,
    taskId: z.string().trim().min(1),
    markdown: z.string().trim().min(1),
  })
  .strict();
export type SetSpecInput = z.infer<typeof SetSpecInputSchema>;

export const SetPlanInputSchema = z
  .object({
    workspaceId: workspaceScopedToolWorkspaceIdSchema,
    taskId: z.string().trim().min(1),
    markdown: z.string().trim().min(1),
    subtasks: z.array(planSubtaskInputSchema.strict()).optional(),
  })
  .strict();
export type SetPlanInput = z.infer<typeof SetPlanInputSchema>;

export const BuildBlockedInputSchema = z
  .object({
    workspaceId: workspaceScopedToolWorkspaceIdSchema,
    taskId: z.string().trim().min(1),
    reason: z.string().trim().min(1),
  })
  .strict();
export type BuildBlockedInput = z.infer<typeof BuildBlockedInputSchema>;

export const BuildResumedInputSchema = z
  .object({
    workspaceId: workspaceScopedToolWorkspaceIdSchema,
    taskId: z.string().trim().min(1),
  })
  .strict();
export type BuildResumedInput = z.infer<typeof BuildResumedInputSchema>;

export const BuildCompletedInputSchema = z
  .object({
    workspaceId: workspaceScopedToolWorkspaceIdSchema,
    taskId: z.string().trim().min(1),
    summary: z.string().optional(),
  })
  .strict();
export type BuildCompletedInput = z.infer<typeof BuildCompletedInputSchema>;

export const SetPullRequestInputSchema = z
  .object({
    workspaceId: workspaceScopedToolWorkspaceIdSchema,
    taskId: z.string().trim().min(1),
    providerId: knownGitProviderIdSchema,
    number: z.number().int().positive(),
  })
  .strict();
export type SetPullRequestInput = z.infer<typeof SetPullRequestInputSchema>;

export const QaApprovedInputSchema = z
  .object({
    workspaceId: workspaceScopedToolWorkspaceIdSchema,
    taskId: z.string().trim().min(1),
    reportMarkdown: z.string().trim().min(1),
  })
  .strict();
export type QaApprovedInput = z.infer<typeof QaApprovedInputSchema>;

export const QaRejectedInputSchema = z
  .object({
    workspaceId: workspaceScopedToolWorkspaceIdSchema,
    taskId: z.string().trim().min(1),
    reportMarkdown: z.string().trim().min(1),
  })
  .strict();
export type QaRejectedInput = z.infer<typeof QaRejectedInputSchema>;

export const CreateTaskInputSchema = z
  .object({
    workspaceId: workspaceScopedToolWorkspaceIdSchema,
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
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

export const SearchTasksInputSchema = z
  .object({
    workspaceId: workspaceScopedToolWorkspaceIdSchema,
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
export type SearchTasksInput = z.infer<typeof SearchTasksInputSchema>;

export const GetWorkspacesInputSchema = z.object({}).strict();
export type GetWorkspacesInput = z.infer<typeof GetWorkspacesInputSchema>;

const pickToolSchemas = <
  TSchemas extends Record<string, unknown>,
  const TNames extends readonly (keyof TSchemas)[],
>(
  schemas: TSchemas,
  toolNames: TNames,
): Pick<TSchemas, TNames[number]> => {
  return Object.fromEntries(toolNames.map((toolName) => [toolName, schemas[toolName]])) as Pick<
    TSchemas,
    TNames[number]
  >;
};

export type OdtToolName = (typeof ODT_MCP_TOOL_NAMES)[number];

export const ODT_TOOL_SCHEMAS = {
  odt_get_workspaces: GetWorkspacesInputSchema,
  odt_create_task: CreateTaskInputSchema,
  odt_search_tasks: SearchTasksInputSchema,
  odt_read_task: ReadTaskInputSchema,
  odt_read_task_documents: ReadTaskDocumentsInputSchema,
  odt_set_spec: SetSpecInputSchema,
  odt_set_plan: SetPlanInputSchema,
  odt_build_blocked: BuildBlockedInputSchema,
  odt_build_resumed: BuildResumedInputSchema,
  odt_build_completed: BuildCompletedInputSchema,
  odt_set_pull_request: SetPullRequestInputSchema,
  odt_qa_approved: QaApprovedInputSchema,
  odt_qa_rejected: QaRejectedInputSchema,
} as const satisfies Record<OdtToolName, unknown>;

export const ODT_WORKFLOW_TOOL_SCHEMAS = pickToolSchemas(
  ODT_TOOL_SCHEMAS,
  ODT_WORKFLOW_AGENT_TOOL_NAMES,
);

export type OdtWorkflowToolName = keyof typeof ODT_WORKFLOW_TOOL_SCHEMAS;

export type WorkflowAgentBlockedOdtToolName =
  (typeof ODT_WORKFLOW_AGENT_BLOCKED_TOOL_NAMES)[number];

export const ODT_WORKFLOW_AGENT_BLOCKED_TOOL_SCHEMAS = pickToolSchemas(
  ODT_TOOL_SCHEMAS,
  ODT_WORKFLOW_AGENT_BLOCKED_TOOL_NAMES,
);

export type WorkspaceScopedOdtToolName = Exclude<
  OdtToolName,
  typeof ODT_WORKSPACE_DISCOVERY_TOOL_NAME
>;

export const ODT_WORKSPACE_SCOPED_TOOL_NAMES = ODT_TOOL_NAMES.filter(
  (toolName): toolName is WorkspaceScopedOdtToolName =>
    toolName !== ODT_WORKSPACE_DISCOVERY_TOOL_NAME,
);

export const ODT_WORKSPACE_SCOPED_TOOL_SCHEMAS = pickToolSchemas(
  ODT_TOOL_SCHEMAS,
  ODT_WORKSPACE_SCOPED_TOOL_NAMES,
);

export const odtPersistedDocumentSchema = z
  .object({
    markdown: z.string(),
    updatedAt: z.string(),
    revision: z.number().int().positive(),
  })
  .strict();
export type OdtPersistedDocument = z.infer<typeof odtPersistedDocumentSchema>;

export const createTaskResultSchema = taskSummarySchema;
export type CreateTaskResult = z.infer<typeof createTaskResultSchema>;

export const searchTasksResultSchema = z
  .object({
    results: z.array(taskSummarySchema),
    limit: z.number().int().positive(),
    totalCount: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  })
  .strict();
export type SearchTasksResult = z.infer<typeof searchTasksResultSchema>;

export const getWorkspacesResultSchema = z
  .object({
    workspaces: z.array(workspaceRecordSchema),
  })
  .strict();
export type GetWorkspacesResult = z.infer<typeof getWorkspacesResultSchema>;

export const setSpecResultSchema = z
  .object({
    task: publicTaskSchema,
    document: odtPersistedDocumentSchema,
  })
  .strict();
export type SetSpecResult = z.infer<typeof setSpecResultSchema>;

export const setPlanResultSchema = z
  .object({
    task: publicTaskSchema,
    document: odtPersistedDocumentSchema,
    createdSubtaskIds: z.array(z.string().trim().min(1)),
  })
  .strict();
export type SetPlanResult = z.infer<typeof setPlanResultSchema>;

export const buildBlockedResultSchema = z
  .object({
    task: publicTaskSchema,
    reason: z.string(),
  })
  .strict();
export type BuildBlockedResult = z.infer<typeof buildBlockedResultSchema>;

export const buildResumedResultSchema = z
  .object({
    task: publicTaskSchema,
  })
  .strict();
export type BuildResumedResult = z.infer<typeof buildResumedResultSchema>;

export const buildCompletedResultSchema = z
  .object({
    task: publicTaskSchema,
    summary: z.string().optional(),
  })
  .strict();
export type BuildCompletedResult = z.infer<typeof buildCompletedResultSchema>;

export const setPullRequestResultSchema = z
  .object({
    task: publicTaskSchema,
    pullRequest: pullRequestSchema,
  })
  .strict();
export type SetPullRequestResult = z.infer<typeof setPullRequestResultSchema>;

export const qaApprovedResultSchema = z
  .object({
    task: publicTaskSchema,
  })
  .strict();
export type QaApprovedResult = z.infer<typeof qaApprovedResultSchema>;

export const qaRejectedResultSchema = z
  .object({
    task: publicTaskSchema,
  })
  .strict();
export type QaRejectedResult = z.infer<typeof qaRejectedResultSchema>;

export const odtHostBridgeReadySchema = z
  .object({
    bridgeVersion: z.literal(1),
    toolNames: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();
export type OdtHostBridgeReady = z.infer<typeof odtHostBridgeReadySchema>;

export const ODT_HOST_BRIDGE_RESPONSE_SCHEMAS = {
  odt_get_workspaces: getWorkspacesResultSchema,
  odt_create_task: createTaskResultSchema,
  odt_search_tasks: searchTasksResultSchema,
  odt_read_task: taskSummarySchema,
  odt_read_task_documents: taskDocumentsReadSchema,
  odt_set_spec: setSpecResultSchema,
  odt_set_plan: setPlanResultSchema,
  odt_build_blocked: buildBlockedResultSchema,
  odt_build_resumed: buildResumedResultSchema,
  odt_build_completed: buildCompletedResultSchema,
  odt_set_pull_request: setPullRequestResultSchema,
  odt_qa_approved: qaApprovedResultSchema,
  odt_qa_rejected: qaRejectedResultSchema,
} as const;
