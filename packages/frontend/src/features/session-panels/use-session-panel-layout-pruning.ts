import { type QueryObserverResult, useQueries } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useWorkspacePresence, useWorkspaceState } from "@/state/app-state-provider";
import { repoTaskIdsQueryOptions } from "@openducktor/frontend-core/queries/tasks";
import { workspaceSessionIdsQueryOptions } from "@openducktor/frontend-core/queries/workspace-sessions";
import { useSessionPanelLayoutStore } from "./session-panel-layout-store";

type WorkspaceLists = {
  taskIds: string[] | null;
  chatIds: string[] | null;
};

/**
 * Removes the saved panel layouts of tasks, chats, and workspaces that no longer exist. It waits
 * until each list that it reads is current.
 */
export function useSessionPanelLayoutPruning(): void {
  const layoutStore = useSessionPanelLayoutStore();
  const { workspaces, closedWorkspaces, activeWorkspace } = useWorkspaceState();
  const { workspaceRecordsAreCurrent } = useWorkspacePresence();
  // The active workspace stays open until the next workspace becomes active.
  const openWorkspaces = useMemo(
    () =>
      activeWorkspace &&
      !workspaces.some(({ workspaceId }) => workspaceId === activeWorkspace.workspaceId)
        ? [...workspaces, activeWorkspace]
        : workspaces,
    [activeWorkspace, workspaces],
  );
  // Key combined results by workspace so Query keeps each list stable across workspace reorders.
  const combineCurrentLists = useCallback(
    <T>(lists: QueryObserverResult<T>[]): Record<string, T | null> =>
      Object.fromEntries(
        openWorkspaces.map(({ workspaceId }, index) => {
          const list = lists[index];
          return [workspaceId, list?.isSuccess && !list.isFetching ? list.data : null];
        }),
      ),
    [openWorkspaces],
  );
  // The Kanban task list hides old closed tasks, so pruning reads the IDs of all tasks.
  const taskLists = useQueries({
    queries: openWorkspaces.map(({ repoPath }) => repoTaskIdsQueryOptions(repoPath)),
    combine: combineCurrentLists<string[]>,
  });
  // The archive display is capped, so it cannot establish which chats still exist.
  const chatLists = useQueries({
    queries: openWorkspaces.map(({ workspaceId }) => workspaceSessionIdsQueryOptions(workspaceId)),
    combine: combineCurrentLists<string[]>,
  });

  // The open and closed lists load and refresh apart, so a closed workspace can miss from both.
  const workspaceIds = useMemo(
    () =>
      workspaceRecordsAreCurrent
        ? new Set([...workspaces, ...closedWorkspaces].map((workspace) => workspace.workspaceId))
        : null,
    [closedWorkspaces, workspaceRecordsAreCurrent, workspaces],
  );
  useEffect(() => {
    if (workspaceIds === null) return;
    layoutStore.prune({ kind: "workspaces", ids: workspaceIds });
  }, [layoutStore, workspaceIds]);

  const previousLists = useRef(new Map<string, WorkspaceLists>());
  useEffect(() => {
    previousLists.current.clear();
  }, [layoutStore]);
  // Each list prunes only when it changes. Other lists can still lack a newly created owner.
  useEffect(() => {
    const nextLists = new Map<string, WorkspaceLists>();
    for (const { workspaceId } of openWorkspaces) {
      const taskIds = taskLists[workspaceId] ?? null;
      const chatIds = chatLists[workspaceId] ?? null;
      const previous = previousLists.current.get(workspaceId);
      if (taskIds !== null && taskIds !== previous?.taskIds) {
        layoutStore.prune({ kind: "tasks", workspaceId, ids: new Set(taskIds) });
      }
      if (chatIds !== null && chatIds !== previous?.chatIds) {
        layoutStore.prune({
          kind: "chats",
          workspaceId,
          ids: new Set(chatIds),
        });
      }
      nextLists.set(workspaceId, { taskIds, chatIds });
    }
    previousLists.current = nextLists;
  }, [chatLists, layoutStore, openWorkspaces, taskLists]);
}
