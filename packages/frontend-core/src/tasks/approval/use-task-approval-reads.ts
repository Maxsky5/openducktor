import { useMinimumLoader } from "../../lib/use-minimum-loader";
import { useTaskApprovalImpact, useTaskCloseReadsPending } from "../details/use-task-close-impact";
import type { TaskApprovalModalModel } from "./task-approval-types";
import { useTaskApprovalMergeCheck } from "./use-task-approval-merge-check";

/**
 * The reads of an open approval. They start when it opens, and each stage shows one loader until
 * they end, so a change of mode reads nothing again.
 */
export function useTaskApprovalReads(model: TaskApprovalModalModel) {
  const impact = useTaskApprovalImpact({
    task: { id: model.taskId, title: model.taskTitle },
    enabled: true,
  });
  const readsPending = useTaskCloseReadsPending(impact.close);
  const mergeCheck = useTaskApprovalMergeCheck(model.taskId);
  // A loader that shows stays at least 500 ms, so a fast read does not flash it.
  const isPreparing = useMinimumLoader(
    (model.stage === "approval" && model.isLoading) || readsPending,
  );
  return { impact, isPreparing, mergeCheck };
}
