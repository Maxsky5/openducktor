import type { TaskMergeStatus, TaskMergeStatusSnapshot } from "@openducktor/contracts";
import {
  type BuiltinTaskCard as TaskCard,
  isMergeDetectionCandidateStatus,
} from "@openducktor/workflows";
import { plural } from "../../lib/plural";
import { canonicalTargetBranch } from "../../lib/target-branch";
import { humanDate } from "./task-display";

export type TaskMergeStatusView = {
  kind: "merged" | "not_merged" | "not_checked" | "failed";
  text: string;
  /** The time of the last successful check, for a failed check. */
  detail?: string;
};

export const findTaskMergeStatus = (
  snapshot: TaskMergeStatusSnapshot | undefined,
  taskId: string,
): TaskMergeStatus | undefined => snapshot?.tasks.find((status) => status.taskId === taskId);

export const mergeTargetLabel = (status: TaskMergeStatus | undefined): string =>
  status?.targetBranch ? canonicalTargetBranch(status.targetBranch) : "the target branch";

/** The merge status text of a detection candidate. A failed check shows its reason first. */
export const describeTaskMergeStatus = (
  status: TaskMergeStatus | undefined,
): TaskMergeStatusView => {
  const target = mergeTargetLabel(status);
  if (status?.failure) {
    const lastCheck =
      status.result.kind === "not_checked"
        ? "No check has succeeded yet."
        : `Last successful check: ${humanDate(status.result.checkedAt)}.`;
    return { kind: "failed", text: status.failure.message, detail: lastCheck };
  }
  switch (status?.result.kind) {
    case "merged":
      return { kind: "merged", text: `Branch merged into ${target}.` };
    case "not_merged":
      return { kind: "not_merged", text: notMergedText(status.result.unmergedCommitCount, target) };
    default:
      return { kind: "not_checked", text: "Merge status not checked yet." };
  }
};

/**
 * The target that a merged task proposes to close into. A task shows the proposal while its
 * last result is merged, its status is a candidate status, and it can close.
 */
export const mergedTaskTarget = (
  task: Pick<TaskCard, "status" | "availableActions">,
  status: TaskMergeStatus | undefined,
): string | null =>
  status?.result.kind === "merged" &&
  isMergeDetectionCandidateStatus(task.status) &&
  task.availableActions.includes("close_task")
    ? mergeTargetLabel(status)
    : null;

/** The merged proposals of a task list, by task ID. */
export const buildMergedTaskTargets = (
  tasks: readonly TaskCard[],
  snapshot: TaskMergeStatusSnapshot | undefined,
): ReadonlyMap<string, string> => {
  const targets = new Map<string, string>();
  if (!snapshot) return targets;
  const statusByTaskId = new Map(snapshot.tasks.map((status) => [status.taskId, status]));
  for (const task of tasks) {
    const target = mergedTaskTarget(task, statusByTaskId.get(task.id));
    if (target !== null) targets.set(task.id, target);
  }
  return targets;
};

const notMergedText = (count: number, target: string): string => {
  if (count === 0) return "Not merged: the branch has no commits of its own.";
  return count === 1
    ? `Not merged: 1 commit is not in ${target}.`
    : `Not merged: ${count} commits are not in ${target}.`;
};

/** What a merge check of one workspace found: the merged task branches and the failed checks. */
export const taskMergeCheckResultText = (snapshot: TaskMergeStatusSnapshot): string => {
  const merged = snapshot.tasks.filter((status) => status.result.kind === "merged").length;
  const failed = snapshot.tasks.filter((status) => status.failure !== undefined).length;
  let found = "No task branch is merged.";
  if (merged === 1) found = "1 task branch is merged. Close the task from the board.";
  if (merged > 1) found = `${merged} task branches are merged. Close the tasks from the board.`;
  return failed === 0 ? found : `${found} ${plural(failed, "check")} failed.`;
};
