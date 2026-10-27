import { z } from "zod";
import {
  gitConflictSchema,
  gitMergeMethodSchema,
  gitTargetBranchSchema,
  pullRequestSchema,
  sourceIssueReferenceSchema,
} from "./git-schemas";
import { workflowArtifactIdSchema, workflowIdSchema } from "./workflow-condition-schemas";

/** A state of the task workflow. The workflow of the task validates it. */
export const taskStatusSchema = workflowIdSchema;

/** A value of the `issueType` fact of the task workflow. */
export const issueTypeSchema = workflowIdSchema;

/** An action of the task workflow. */
export const taskActionSchema = workflowIdSchema;

/**
 * Whether a close of the task removes its worktree and local task branch. Null follows the global
 * Git setting of the same name.
 */
export const taskRemoveWorktreeOnCloseSchema = z.boolean().nullable();

export const taskPrioritySchema = z.number().int().min(0).max(4);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

/** The state of one workflow artifact of a task. Only a present review has a verdict. */
export const taskArtifactStateSchema = z.object({
  present: z.boolean(),
  verdict: workflowIdSchema.optional(),
  updatedAt: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
});
export type TaskArtifactState = z.infer<typeof taskArtifactStateSchema>;

/** Keyed by the workflow artifact IDs. The task workflow definition declares them. */
export const taskArtifactSummarySchema = z.record(
  workflowArtifactIdSchema,
  taskArtifactStateSchema,
);
export type TaskArtifactSummary = z.infer<typeof taskArtifactSummarySchema>;

export const agentWorkflowStateSchema = z.object({
  required: z.boolean(),
  canSkip: z.boolean(),
  available: z.boolean(),
  completed: z.boolean(),
});
export type AgentWorkflowState = z.infer<typeof agentWorkflowStateSchema>;

/** The step state of each role of the task workflow. The host derives it from the workflow. */
const agentWorkflowsSchema = z.record(workflowIdSchema, agentWorkflowStateSchema);
export type AgentWorkflows = z.infer<typeof agentWorkflowsSchema>;

export const taskCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional().default(""),
  status: taskStatusSchema,
  priority: taskPrioritySchema.default(2),
  issueType: issueTypeSchema,
  removeWorktreeOnClose: taskRemoveWorktreeOnCloseSchema.default(null),
  availableActions: z.array(taskActionSchema),
  labels: z.array(z.string()).default([]),
  targetBranch: z.preprocess(
    (value) => (value === null ? undefined : value),
    gitTargetBranchSchema.optional(),
  ),
  targetBranchError: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.string().optional(),
  ),
  pullRequest: z.preprocess(
    (value) => (value === null ? undefined : value),
    pullRequestSchema.optional(),
  ),
  sourceIssue: z.preprocess(
    (value) => (value === null ? undefined : value),
    sourceIssueReferenceSchema.optional(),
  ),
  artifactSummary: taskArtifactSummarySchema,
  agentWorkflows: agentWorkflowsSchema,
  updatedAt: z.string(),
  createdAt: z.string(),
});
export type TaskCard = z.infer<typeof taskCardSchema>;

export const taskDirectMergeInputSchema = z.strictObject({
  expected: z.strictObject({
    taskStatus: taskStatusSchema,
    sourceBranch: z.string().min(1),
    targetBranch: gitTargetBranchSchema,
  }),
  mergeMethod: gitMergeMethodSchema,
  squashCommitMessage: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
  /** A merge that closes the task removes the task worktree and its local task branch. */
  removeWorktree: z.boolean(),
});
export type TaskDirectMergeInput = z.infer<typeof taskDirectMergeInputSchema>;

export const taskDirectMergeResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("completed"),
    task: taskCardSchema,
  }),
  z.object({
    outcome: z.literal("conflicts"),
    conflict: gitConflictSchema,
  }),
]);
export type TaskDirectMergeResult = z.infer<typeof taskDirectMergeResultSchema>;

export const taskCreateInputSchema = z.object({
  title: z.string().min(1),
  issueType: issueTypeSchema,
  priority: taskPrioritySchema.default(2),
  description: z.string().optional(),
  labels: z.array(z.string()).optional(),
  removeWorktreeOnClose: taskRemoveWorktreeOnCloseSchema.optional(),
});
export type TaskCreateInput = z.infer<typeof taskCreateInputSchema>;

export const taskUpdatePatchSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  priority: taskPrioritySchema.optional(),
  issueType: issueTypeSchema.optional(),
  labels: z.array(z.string()).optional(),
  targetBranch: z.preprocess(
    (value) => (value === null ? undefined : value),
    gitTargetBranchSchema.optional(),
  ),
  removeWorktreeOnClose: taskRemoveWorktreeOnCloseSchema.optional(),
});
export type TaskUpdatePatch = z.infer<typeof taskUpdatePatchSchema>;

export const taskStopImpactOperationSchema = z.enum([
  "close",
  "delete",
  "reset_implementation",
  "reset_task",
]);
export type TaskStopImpactOperation = z.infer<typeof taskStopImpactOperationSchema>;

export const taskStopImpactRequestSchema = z.object({
  repoPath: z.string().min(1),
  taskIds: z.array(z.string().min(1)),
  operation: taskStopImpactOperationSchema,
});
export type TaskStopImpactRequest = z.infer<typeof taskStopImpactRequestSchema>;

export const taskStopImpactSchema = z.object({
  stoppableSessionCount: z.number().int().nonnegative(),
  /**
   * The existing task worktrees that Close, Delete, or Reset Task removes. Reset Implementation
   * omits it. Hosts older than this field omit it too.
   */
  removedWorktreeCount: z.number().int().nonnegative().optional(),
});
export type TaskStopImpact = z.infer<typeof taskStopImpactSchema>;

export const taskCloseInputSchema = z.strictObject({
  repoPath: z.string().min(1),
  taskId: z.string().min(1),
  /** The close removes the task worktree and its local task branch. */
  removeWorktree: z.boolean(),
});
export type TaskCloseInput = z.infer<typeof taskCloseInputSchema>;

/** What a close or a worktree removal does to the worktrees and branches of one task. */
export const taskWorktreeCleanupImpactSchema = z.object({
  /** The existing worktrees that a cleanup removes: the task worktree and session worktrees. */
  worktreePaths: z.array(z.string()),
  /** The local task branches that a cleanup deletes. */
  branchNames: z.array(z.string()),
  uncommittedFileCount: z.number().int().nonnegative(),
  /** The task matches the merge detection candidate rule. */
  mergeCandidate: z.boolean(),
  /** The current tip of the task branch. Null when the task has no single task branch. */
  branchOid: z.string().nullable(),
});
export type TaskWorktreeCleanupImpact = z.infer<typeof taskWorktreeCleanupImpactSchema>;
