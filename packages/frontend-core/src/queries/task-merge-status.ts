import type { TaskMergeStatusSnapshot } from "@openducktor/contracts";
import { type QueryClient, type QueryKey, queryOptions } from "@tanstack/react-query";
import { connectionHost, connectionOf } from "../connection/client-connection";
import { errorMessage } from "../lib/errors";
import { CONNECTION_RECONNECTED_EVENT_KIND } from "../recovery/connection-control-events";
import { SKIPPED_QUERY_KEY_SEGMENT, skippedQueryOptions } from "./skipped-query";

export const taskMergeStatusQueryKeys = {
  all: ["task-merge-status"] as const,
  repo: (repoPath: string) => [...taskMergeStatusQueryKeys.all, "repo", repoPath] as const,
  skipped: ["task-merge-status", SKIPPED_QUERY_KEY_SEGMENT] as const,
};

export const taskMergeStatusQueryOptions = (repoPath: string) =>
  queryOptions<TaskMergeStatusSnapshot, Error, TaskMergeStatusSnapshot, QueryKey>({
    queryKey: taskMergeStatusQueryKeys.repo(repoPath),
    queryFn: ({ client }) => connectionHost(client).taskMergeStatusGet(repoPath),
    // The host event stream replaces this snapshot, so the read never goes stale on its own.
    staleTime: Number.POSITIVE_INFINITY,
  });

/** The merge status read of the active workspace, or a skipped read without a workspace. */
export const workspaceTaskMergeStatusQueryOptions = (repoPath: string | null) =>
  repoPath === null
    ? skippedQueryOptions<TaskMergeStatusSnapshot, QueryKey>({
        queryKey: taskMergeStatusQueryKeys.skipped,
        staleTime: Number.POSITIVE_INFINITY,
      })
    : taskMergeStatusQueryOptions(repoPath);

/** Fetches and runs a host detection pass for the workspace, then stores its snapshot. */
export const checkTaskMergeStatus = async (
  queryClient: QueryClient,
  repoPath: string,
): Promise<TaskMergeStatusSnapshot> => {
  const snapshot = await connectionHost(queryClient).taskMergeStatusCheck(repoPath);
  await replaceTaskMergeStatus(queryClient, snapshot);
  return snapshot;
};

/**
 * Keeps the merge status snapshots of a query client current from the host event stream. A
 * reconnect that missed events reads every snapshot again. Returns the unsubscribe.
 */
export const observeTaskMergeStatusUpdates = (queryClient: QueryClient): (() => void) => {
  const connection = connectionOf(queryClient);
  let closed = false;
  let stop: (() => void) | null = null;
  void connection.host
    .subscribeTaskMergeStatusUpdates((event) => {
      if (closed) return;
      if ("__openducktorConnectionControl" in event) {
        if (event.kind === CONNECTION_RECONNECTED_EVENT_KIND && event.missedEvents) {
          return queryClient.invalidateQueries({
            queryKey: [...taskMergeStatusQueryKeys.all, "repo"],
          });
        }
        return;
      }
      return replaceTaskMergeStatus(queryClient, event);
    })
    .then((unsubscribe) => {
      if (closed) unsubscribe();
      else stop = unsubscribe;
    })
    .catch((cause: unknown) => {
      if (closed) return;
      connection.feedback.show("warning", "Merge status does not update live", {
        id: MERGE_STATUS_FEEDBACK_ID,
        description: `${errorMessage(cause)} Reload OpenDucktor to try again.`,
        duration: Number.POSITIVE_INFINITY,
      });
    });
  return () => {
    closed = true;
    stop?.();
  };
};

/** Stores a snapshot. A read in progress could return an older snapshot, so it stops first. */
const replaceTaskMergeStatus = async (
  queryClient: QueryClient,
  snapshot: TaskMergeStatusSnapshot,
): Promise<void> => {
  const queryKey = taskMergeStatusQueryKeys.repo(snapshot.repoPath);
  await queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData(queryKey, snapshot);
};

const MERGE_STATUS_FEEDBACK_ID = "task-merge-status-updates";
