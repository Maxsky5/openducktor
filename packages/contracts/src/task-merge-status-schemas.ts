import { z } from "zod";
import { gitTargetBranchSchema } from "./git-schemas";

/**
 * The last successful merge check of a task branch. `branchOid` is the branch tip that the check
 * saw, so a reader can tell when the branch moved after the check.
 */
export const taskMergeCheckResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("not_checked") }),
  z.object({ kind: z.literal("merged"), checkedAt: z.string(), branchOid: z.string() }),
  z.object({
    kind: z.literal("not_merged"),
    checkedAt: z.string(),
    branchOid: z.string(),
    /** The commits of the task branch that the target does not have. */
    unmergedCommitCount: z.number().int().nonnegative(),
  }),
]);
export type TaskMergeCheckResult = z.infer<typeof taskMergeCheckResultSchema>;

export const taskMergeCheckFailureSchema = z.object({
  message: z.string(),
  failedAt: z.string(),
});
export type TaskMergeCheckFailure = z.infer<typeof taskMergeCheckFailureSchema>;

/** The merge detection state of one candidate task. */
export const taskMergeStatusSchema = z.object({
  taskId: z.string(),
  /** Null when the task branch is unknown. `failure` then says why. */
  branch: z.string().nullable(),
  /** Null when the task target is invalid. `failure` then says why. */
  targetBranch: gitTargetBranchSchema.nullable(),
  result: taskMergeCheckResultSchema,
  /** The last check failed. `result` keeps the last successful result. */
  failure: taskMergeCheckFailureSchema.optional(),
});
export type TaskMergeStatus = z.infer<typeof taskMergeStatusSchema>;

/** The merge detection state of all candidate tasks of one workspace. */
export const taskMergeStatusSnapshotSchema = z.object({
  repoPath: z.string(),
  tasks: z.array(taskMergeStatusSchema),
});
export type TaskMergeStatusSnapshot = z.infer<typeof taskMergeStatusSnapshotSchema>;

export const taskMergeStatusRequestSchema = z.strictObject({
  repoPath: z.string().min(1),
});
export type TaskMergeStatusRequest = z.infer<typeof taskMergeStatusRequestSchema>;
