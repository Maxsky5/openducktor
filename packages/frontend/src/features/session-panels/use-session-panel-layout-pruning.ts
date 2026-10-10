import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useWorkspacePresence, useWorkspaceState } from "@/state/app-state-provider";
import { repoTaskIdsQueryOptions } from "@/state/queries/tasks";
import { workspaceSessionListQueryOptions } from "@/state/queries/workspace-sessions";
import { pruneSessionPanelLayouts } from "./session-panel-layout-store";

/**
 * Removes the saved panel layouts of tasks, chats, and workspaces that no longer exist. It waits
 * until each list that it reads is current.
 */
export function useSessionPanelLayoutPruning(): void {
  const { workspaces, closedWorkspaces, activeWorkspace } = useWorkspaceState();
  const { workspaceRecordsAreCurrent } = useWorkspacePresence();
  const workspaceId = activeWorkspace?.workspaceId ?? null;
  const repoPath = activeWorkspace?.repoPath ?? null;
  // The Kanban task list hides old closed tasks, so pruning reads the IDs of all tasks.
  const taskIdList = useQuery({
    ...repoTaskIdsQueryOptions(repoPath ?? ""),
    enabled: repoPath !== null,
  });
  const activeChats = useQuery({
    ...workspaceSessionListQueryOptions(workspaceId ?? "", false),
    enabled: workspaceId !== null,
  });
  const archivedChats = useQuery({
    ...workspaceSessionListQueryOptions(workspaceId ?? "", true),
    enabled: workspaceId !== null,
  });

  // The open and closed lists load and refresh apart, so a closed workspace can miss from both.
  const workspaceIds = useMemo(
    () =>
      workspaceRecordsAreCurrent
        ? new Set([...workspaces, ...closedWorkspaces].map((workspace) => workspace.workspaceId))
        : null,
    [closedWorkspaces, workspaceRecordsAreCurrent, workspaces],
  );
  const isTaskListCurrent = taskIdList.isSuccess && !taskIdList.isFetching;
  const taskIds = useMemo(
    () => (isTaskListCurrent ? new Set(taskIdList.data) : null),
    [isTaskListCurrent, taskIdList.data],
  );
  const isChatListCurrent =
    activeChats.isSuccess &&
    archivedChats.isSuccess &&
    !activeChats.isFetching &&
    !archivedChats.isFetching;
  const chatIds = useMemo(
    () =>
      isChatListCurrent
        ? new Set(
            [...(activeChats.data ?? []), ...(archivedChats.data ?? [])].map((chat) => chat.id),
          )
        : null,
    [activeChats.data, archivedChats.data, isChatListCurrent],
  );

  // Each list prunes only when it changes, so a refresh of one list never acts on an older copy
  // of another list, such as a task list that does not have a new task yet.
  useEffect(() => {
    if (workspaceIds === null) return;
    pruneSessionPanelLayouts({ kind: "workspaces", ids: workspaceIds });
  }, [workspaceIds]);
  useEffect(() => {
    if (workspaceId === null || taskIds === null) return;
    pruneSessionPanelLayouts({ kind: "tasks", workspaceId, ids: taskIds });
  }, [taskIds, workspaceId]);
  useEffect(() => {
    if (workspaceId === null || chatIds === null) return;
    pruneSessionPanelLayouts({ kind: "chats", workspaceId, ids: chatIds });
  }, [chatIds, workspaceId]);
}
