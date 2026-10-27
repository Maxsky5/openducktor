import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { workspaceTaskMergeStatusQueryOptions } from "../../queries/task-merge-status";
import {
  buildMergedTaskTargets,
  findTaskMergeStatus,
  mergedTaskTarget,
} from "../presentation/task-merge-status";

/** The target of each task whose branch is merged. A board card then proposes Close Task. */
export const useMergedTaskTargets = (
  repoPath: string | null,
  tasks: readonly TaskCard[],
): ReadonlyMap<string, string> => {
  const mergeStatus = useQuery(workspaceTaskMergeStatusQueryOptions(repoPath));
  return useMemo(() => buildMergedTaskTargets(tasks, mergeStatus.data), [tasks, mergeStatus.data]);
};

/** The target that the branch of one task is merged into, or null. Close Task then leads. */
export const useMergedTaskTarget = (
  repoPath: string | null,
  task: Pick<TaskCard, "id" | "status" | "availableActions"> | null,
): string | null => {
  const mergeStatus = useQuery(workspaceTaskMergeStatusQueryOptions(repoPath));
  return task ? mergedTaskTarget(task, findTaskMergeStatus(mergeStatus.data, task.id)) : null;
};
