import { z } from "zod";
import { gitTargetBranchSchema, pullRequestSchema, workspaceRecordSchema } from "./git-schemas";
import { odtToolWorkspaceIdSchema } from "./odt-tool-workspace-id-schema";
import {
  ODT_BROWSER_TOOL_NAMES,
  ODT_BROWSER_TOOL_SCHEMAS,
  type OdtBrowserToolName,
  odtBrowserToolResultSchema,
} from "./odt-browser-tool-schemas";
import {
  ODT_TOOL_NAMES,
  ODT_WORKFLOW_AGENT_BLOCKED_TOOL_NAMES,
  ODT_WORKSPACE_DISCOVERY_TOOL_NAME,
} from "./odt-tool-names";
import {
  TASK_ASSET_MAX_DESCRIPTION_ASSETS,
  TASK_ASSET_MAX_FILE_BYTES,
  taskAssetIdSchema,
  taskAssetMediaTypeSchema,
} from "./task-asset-schemas";
import {
  issueTypeSchema,
  qaWorkflowVerdictSchema,
  taskPrioritySchema,
  taskStatusSchema,
} from "./task-schemas";

const odtToolErrorDetailsSchema = z.record(z.string(), z.json());

export const ODT_READ_TASK_ASSETS_MAX_TOTAL_BYTES = 20 * 1024 * 1024;

export const odtToolErrorCodeSchema = z.enum([
  "TASK_POLICY_ERROR",
  "TASK_TRANSITION_NOT_ALLOWED",
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
    details: odtToolErrorDetailsSchema.optional(),
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

/**
 * MCP clients such as Codex show these schemas to the model, so a description says only what the
 * field name and type do not.
 */
const TASK_PRIORITY_DESCRIPTION = "0 critical, 1 high, 2 normal, 3 low, 4 very low.";

export const publicTaskSchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.string(),
    description: z.string().describe("Empty when not set."),
    status: taskStatusSchema,
    priority: taskPrioritySchema.describe(TASK_PRIORITY_DESCRIPTION),
    issueType: issueTypeSchema,
    aiReviewEnabled: z.boolean().describe("True when QA review runs before human review."),
    labels: z.array(z.string()),
    targetBranch: gitTargetBranchSchema.optional().describe("Target branch override."),
    createdAt: z.string(),
    updatedAt: z.string(),
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

export const ReadTaskInputSchema = z
  .object({
    workspaceId: odtToolWorkspaceIdSchema,
    taskId: z.string().trim().min(1),
  })
  .strict();
export type ReadTaskInput = z.infer<typeof ReadTaskInputSchema>;

export const ReadTaskAssetsInputSchema = z
  .object({
    workspaceId: odtToolWorkspaceIdSchema,
    taskId: z.string().trim().min(1),
    assetIds: z
      .array(taskAssetIdSchema)
      .min(1)
      .max(TASK_ASSET_MAX_DESCRIPTION_ASSETS)
      .refine((ids) => new Set(ids).size === ids.length, "Asset IDs must be distinct."),
  })
  .strict();
export type ReadTaskAssetsInput = z.infer<typeof ReadTaskAssetsInputSchema>;

export const ReadTaskDocumentsInputSchema = z
  .object({
    workspaceId: odtToolWorkspaceIdSchema,
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

const publicEpicRejectionReason = "Epic creation is not supported by the public MCP create tool.";
const publicEpicUpdateRejectionReason =
  "Epic updates are not supported by the public MCP update tool.";

const publicIssueTypeSchema = (rejectionReason: string) =>
  z.enum(["task", "feature", "bug"], {
    error: `issueType must be task, feature, or bug. ${rejectionReason}`,
  });
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
    workspaceId: odtToolWorkspaceIdSchema,
    taskId: z.string().trim().min(1),
    markdown: z.string().trim().min(1),
  })
  .strict();
export type SetSpecInput = z.infer<typeof SetSpecInputSchema>;

export const SetPlanInputSchema = z
  .object({
    workspaceId: odtToolWorkspaceIdSchema,
    taskId: z.string().trim().min(1),
    markdown: z.string().trim().min(1),
  })
  .strict();
export type SetPlanInput = z.infer<typeof SetPlanInputSchema>;

export const BuildBlockedInputSchema = z
  .object({
    workspaceId: odtToolWorkspaceIdSchema,
    taskId: z.string().trim().min(1),
    reason: z.string().trim().min(1),
  })
  .strict();
export type BuildBlockedInput = z.infer<typeof BuildBlockedInputSchema>;

export const BuildResumedInputSchema = z
  .object({
    workspaceId: odtToolWorkspaceIdSchema,
    taskId: z.string().trim().min(1),
  })
  .strict();
export type BuildResumedInput = z.infer<typeof BuildResumedInputSchema>;

export const BuildCompletedInputSchema = z
  .object({
    workspaceId: odtToolWorkspaceIdSchema,
    taskId: z.string().trim().min(1),
    summary: z.string().optional(),
  })
  .strict();
export type BuildCompletedInput = z.infer<typeof BuildCompletedInputSchema>;

export const SetPullRequestInputSchema = z
  .object({
    workspaceId: odtToolWorkspaceIdSchema,
    taskId: z.string().trim().min(1),
    number: z.number().int().positive(),
  })
  .strict();
export type SetPullRequestInput = z.infer<typeof SetPullRequestInputSchema>;

export const QaApprovedInputSchema = z
  .object({
    workspaceId: odtToolWorkspaceIdSchema,
    taskId: z.string().trim().min(1),
    reportMarkdown: z.string().trim().min(1),
  })
  .strict();
export type QaApprovedInput = z.infer<typeof QaApprovedInputSchema>;

export const QaRejectedInputSchema = z
  .object({
    workspaceId: odtToolWorkspaceIdSchema,
    taskId: z.string().trim().min(1),
    reportMarkdown: z.string().trim().min(1),
  })
  .strict();
export type QaRejectedInput = z.infer<typeof QaRejectedInputSchema>;

export const CreateTaskInputSchema = z
  .object({
    workspaceId: odtToolWorkspaceIdSchema,
    title: z.string().trim().min(1),
    issueType: publicIssueTypeSchema(publicEpicRejectionReason),
    priority: taskPrioritySchema.describe(TASK_PRIORITY_DESCRIPTION),
    description: z.string().trim().min(1).optional(),
    labels: z.array(labelStringSchema).optional(),
    aiReviewEnabled: z.boolean().optional().describe("Overrides whether QA review is required."),
  })
  .strict();
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

export const SearchTasksInputSchema = z
  .object({
    workspaceId: odtToolWorkspaceIdSchema,
    priority: taskPrioritySchema.optional(),
    issueType: issueTypeSchema.optional(),
    status: activeTaskStatusSchema.optional(),
    title: z.string().trim().min(1).optional().describe("Case-insensitive substring."),
    tags: z.array(labelStringSchema).min(1).optional(),
    limit: z.number().int().positive().max(100).default(50),
  })
  .strict();
export type SearchTasksInput = z.infer<typeof SearchTasksInputSchema>;

export const UpdateTaskInputSchema = z
  .object({
    workspaceId: odtToolWorkspaceIdSchema,
    taskId: z.string().trim().min(1),
    title: z.string().trim().min(1).optional(),
    description: z.string().trim().optional(),
    priority: taskPrioritySchema.optional().describe(TASK_PRIORITY_DESCRIPTION),
    labels: z.array(labelStringSchema).optional(),
    issueType: publicIssueTypeSchema(publicEpicUpdateRejectionReason).optional(),
    aiReviewEnabled: z.boolean().optional().describe("False turns QA review off."),
  })
  .strict();
export type UpdateTaskInput = z.infer<typeof UpdateTaskInputSchema>;

export const GetWorkspacesInputSchema = z.object({}).strict();
export type GetWorkspacesInput = z.infer<typeof GetWorkspacesInputSchema>;

export const odtToolNameSchema = z.enum(ODT_TOOL_NAMES);
export type OdtToolName = z.infer<typeof odtToolNameSchema>;

export const ODT_TOOL_SCHEMAS = {
  odt_get_workspaces: GetWorkspacesInputSchema,
  odt_create_task: CreateTaskInputSchema,
  odt_search_tasks: SearchTasksInputSchema,
  odt_read_task: ReadTaskInputSchema,
  odt_read_task_assets: ReadTaskAssetsInputSchema,
  odt_read_task_documents: ReadTaskDocumentsInputSchema,
  odt_update_task: UpdateTaskInputSchema,
  odt_set_spec: SetSpecInputSchema,
  odt_set_plan: SetPlanInputSchema,
  odt_build_blocked: BuildBlockedInputSchema,
  odt_build_resumed: BuildResumedInputSchema,
  odt_build_completed: BuildCompletedInputSchema,
  odt_set_pull_request: SetPullRequestInputSchema,
  odt_qa_approved: QaApprovedInputSchema,
  odt_qa_rejected: QaRejectedInputSchema,
  ...ODT_BROWSER_TOOL_SCHEMAS,
} as const satisfies Record<OdtToolName, z.ZodTypeAny>;

export const ODT_WORKFLOW_TOOL_SCHEMAS = {
  odt_create_task: ODT_TOOL_SCHEMAS.odt_create_task,
  odt_search_tasks: ODT_TOOL_SCHEMAS.odt_search_tasks,
  odt_read_task: ODT_TOOL_SCHEMAS.odt_read_task,
  odt_read_task_assets: ODT_TOOL_SCHEMAS.odt_read_task_assets,
  odt_read_task_documents: ODT_TOOL_SCHEMAS.odt_read_task_documents,
  odt_update_task: ODT_TOOL_SCHEMAS.odt_update_task,
  odt_set_spec: ODT_TOOL_SCHEMAS.odt_set_spec,
  odt_set_plan: ODT_TOOL_SCHEMAS.odt_set_plan,
  odt_build_blocked: ODT_TOOL_SCHEMAS.odt_build_blocked,
  odt_build_resumed: ODT_TOOL_SCHEMAS.odt_build_resumed,
  odt_build_completed: ODT_TOOL_SCHEMAS.odt_build_completed,
  odt_set_pull_request: ODT_TOOL_SCHEMAS.odt_set_pull_request,
  odt_qa_approved: ODT_TOOL_SCHEMAS.odt_qa_approved,
  odt_qa_rejected: ODT_TOOL_SCHEMAS.odt_qa_rejected,
  ...ODT_BROWSER_TOOL_SCHEMAS,
} as const;

export type OdtWorkflowToolName = keyof typeof ODT_WORKFLOW_TOOL_SCHEMAS;

export type WorkflowAgentBlockedOdtToolName =
  (typeof ODT_WORKFLOW_AGENT_BLOCKED_TOOL_NAMES)[number];

export const ODT_WORKFLOW_AGENT_BLOCKED_TOOL_SCHEMAS = {
  odt_get_workspaces: ODT_TOOL_SCHEMAS.odt_get_workspaces,
} as const;

export type WorkspaceScopedOdtToolName = Exclude<
  OdtToolName,
  typeof ODT_WORKSPACE_DISCOVERY_TOOL_NAME
>;

export const ODT_WORKSPACE_SCOPED_TOOL_NAMES = ODT_TOOL_NAMES.filter(
  (toolName): toolName is WorkspaceScopedOdtToolName =>
    toolName !== ODT_WORKSPACE_DISCOVERY_TOOL_NAME,
);

export const ODT_WORKSPACE_SCOPED_TOOL_SCHEMAS = {
  odt_create_task: ODT_TOOL_SCHEMAS.odt_create_task,
  odt_search_tasks: ODT_TOOL_SCHEMAS.odt_search_tasks,
  odt_read_task: ODT_TOOL_SCHEMAS.odt_read_task,
  odt_read_task_assets: ODT_TOOL_SCHEMAS.odt_read_task_assets,
  odt_read_task_documents: ODT_TOOL_SCHEMAS.odt_read_task_documents,
  odt_update_task: ODT_TOOL_SCHEMAS.odt_update_task,
  odt_set_spec: ODT_TOOL_SCHEMAS.odt_set_spec,
  odt_set_plan: ODT_TOOL_SCHEMAS.odt_set_plan,
  odt_build_blocked: ODT_TOOL_SCHEMAS.odt_build_blocked,
  odt_build_resumed: ODT_TOOL_SCHEMAS.odt_build_resumed,
  odt_build_completed: ODT_TOOL_SCHEMAS.odt_build_completed,
  odt_set_pull_request: ODT_TOOL_SCHEMAS.odt_set_pull_request,
  odt_qa_approved: ODT_TOOL_SCHEMAS.odt_qa_approved,
  odt_qa_rejected: ODT_TOOL_SCHEMAS.odt_qa_rejected,
  ...ODT_BROWSER_TOOL_SCHEMAS,
} as const;

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

const base64ByteSize = (value: string): number => {
  let padding = 0;
  if (value.endsWith("==")) {
    padding = 2;
  } else if (value.endsWith("=")) {
    padding = 1;
  }
  return (value.length / 4) * 3 - padding;
};

const readTaskAssetResultItemSchema = z
  .object({
    assetId: taskAssetIdSchema,
    mediaType: taskAssetMediaTypeSchema,
    byteSize: z.number().int().nonnegative().max(TASK_ASSET_MAX_FILE_BYTES),
    dataBase64: z.base64(),
  })
  .strict()
  .superRefine((asset, ctx) => {
    if (base64ByteSize(asset.dataBase64) !== asset.byteSize) {
      ctx.addIssue({
        code: "custom",
        path: ["byteSize"],
        message: "Task asset byteSize must match the decoded base64 payload.",
      });
    }
  });

export const readTaskAssetsResultSchema = z
  .object({
    assets: z
      .array(readTaskAssetResultItemSchema)
      .min(1)
      .max(TASK_ASSET_MAX_DESCRIPTION_ASSETS)
      .refine(
        (assets) => new Set(assets.map((asset) => asset.assetId)).size === assets.length,
        "Asset IDs must be distinct.",
      ),
  })
  .strict()
  .superRefine((result, ctx) => {
    const totalByteSize = result.assets.reduce((total, asset) => total + asset.byteSize, 0);
    if (totalByteSize > ODT_READ_TASK_ASSETS_MAX_TOTAL_BYTES) {
      ctx.addIssue({
        code: "custom",
        path: ["assets"],
        message: `Task asset batches must be ${ODT_READ_TASK_ASSETS_MAX_TOTAL_BYTES} bytes or smaller.`,
      });
    }
  });
export type ReadTaskAssetsResult = z.infer<typeof readTaskAssetsResultSchema>;

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

// SAFETY: the entries map every browser tool name to the one browser result schema.
const ODT_BROWSER_TOOL_RESPONSE_SCHEMAS = Object.fromEntries(
  ODT_BROWSER_TOOL_NAMES.map((toolName) => [toolName, odtBrowserToolResultSchema]),
) as Record<OdtBrowserToolName, typeof odtBrowserToolResultSchema>;

export const ODT_HOST_BRIDGE_RESPONSE_SCHEMAS = {
  odt_get_workspaces: getWorkspacesResultSchema,
  odt_create_task: createTaskResultSchema,
  odt_search_tasks: searchTasksResultSchema,
  odt_read_task: taskSummarySchema,
  odt_read_task_assets: readTaskAssetsResultSchema,
  odt_read_task_documents: taskDocumentsReadSchema,
  odt_update_task: taskSummarySchema,
  odt_set_spec: setSpecResultSchema,
  odt_set_plan: setPlanResultSchema,
  odt_build_blocked: buildBlockedResultSchema,
  odt_build_resumed: buildResumedResultSchema,
  odt_build_completed: buildCompletedResultSchema,
  odt_set_pull_request: setPullRequestResultSchema,
  odt_qa_approved: qaApprovedResultSchema,
  odt_qa_rejected: qaRejectedResultSchema,
  ...ODT_BROWSER_TOOL_RESPONSE_SCHEMAS,
} as const;
