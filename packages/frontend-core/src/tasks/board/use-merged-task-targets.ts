import type { WorkspaceRef } from "@openducktor/contracts";
import type { ResolvedTaskCard as TaskCard } from "@openducktor/workflows";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { workspaceTaskMergeStatusQueryOptions } from "../../queries/task-merge-status";
import {
  buildAutoCloseFailures,
  buildMergedTaskTargets,
  findTaskMergeStatus,
  mergedTaskTarget,
} from "../presentation/task-merge-status";

/** The target of each task whose branch is merged. A board card then proposes Close Task. */
export const useMergedTaskTargets = (
  repoPath: WorkspaceRef | null,
  tasks: readonly TaskCard[],
): ReadonlyMap<string, string> => {
  const mergeStatus = useQuery(workspaceTaskMergeStatusQueryOptions(repoPath));
  return useMemo(() => buildMergedTaskTargets(tasks, mergeStatus.data), [tasks, mergeStatus.data]);
};

/** The target that the branch of one task is merged into, or null. Close Task then leads. */
export const useMergedTaskTarget = (
  repoPath: WorkspaceRef | null,
  task: Pick<TaskCard, "id" | "status" | "availableActions" | "taskWorkflow"> | null,
): string | null => {
  const mergeStatus = useQuery(workspaceTaskMergeStatusQueryOptions(repoPath));
  return task ? mergedTaskTarget(task, findTaskMergeStatus(mergeStatus.data, task.id)) : null;
};

/** Why the pull request sync could not close each task, by task ID. The card shows it. */
export const useAutoCloseFailures = (
  repoPath: WorkspaceRef | null,
  tasks: readonly TaskCard[],
): ReadonlyMap<string, string> => {
  const mergeStatus = useQuery(workspaceTaskMergeStatusQueryOptions(repoPath));
  return useMemo(() => buildAutoCloseFailures(tasks, mergeStatus.data), [tasks, mergeStatus.data]);
};

/** Why the pull request sync could not close one task, or null. */
export const useAutoCloseFailure = (
  repoPath: WorkspaceRef | null,
  task: Pick<TaskCard, "id" | "status"> | null,
): string | null => {
  const mergeStatus = useQuery(workspaceTaskMergeStatusQueryOptions(repoPath));
  return task ? (buildAutoCloseFailures([task], mergeStatus.data).get(task.id) ?? null) : null;
};
