import { workspaceListQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useRepoTask } from "./use-repo-task";
import { type OwnerResolution, type ResolvedTaskOwner, resolveTaskOwner } from "./work-owner-model";
import type { WorkOwnerRef } from "./work-owner-params";

/** The workspace list read that owner resolution uses. */
export const useWorkspaceListRead = () => {
  const { data, error, isPending, refetch } = useQuery(workspaceListQueryOptions());
  const read = useMemo(() => ({ data, error, isPending }), [data, error, isPending]);
  return { read, refetch };
};

/**
 * The workspace and task of a task owner, without the Git reads of its work views. The task list
 * of the workspace is the cache that the task stream keeps current.
 */
export type TaskOwnerResolution = {
  resolution: OwnerResolution<ResolvedTaskOwner>;
  /** The repository of the workspace, or null until the workspace resolves. */
  repoPath: string | null;
  retry: () => void;
};

export const useTaskOwnerResolution = (
  ownerRef: Extract<WorkOwnerRef, { kind: "task" }>,
): TaskOwnerResolution => {
  const workspaces = useWorkspaceListRead();
  const workspace =
    workspaces.read.data?.find((entry) => entry.workspaceId === ownerRef.workspaceId) ?? null;
  const repoPath = workspace?.repoPath ?? null;
  const taskRead = useRepoTask(repoPath, ownerRef.taskId);
  const { tasks, error, isPending } = taskRead;
  const resolution = useMemo(
    () => resolveTaskOwner(ownerRef, workspaces.read, { data: tasks, error, isPending }),
    [error, isPending, ownerRef, tasks, workspaces.read],
  );
  const { refetch: refetchWorkspaces } = workspaces;
  const { refetch: refetchTask } = taskRead;
  const retry = useCallback(() => {
    void refetchWorkspaces();
    refetchTask();
  }, [refetchTask, refetchWorkspaces]);
  return { resolution, repoPath, retry };
};
