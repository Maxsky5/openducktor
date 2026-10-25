import { useActiveWorkspaceContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { useMobileWorkspaces } from "@/composition/workspace-selection";

/**
 * Task workflow actions run in the workspace that this app selects. Task details of another
 * workspace, such as one opened from Activity, select their workspace while they have focus.
 * Actions wait until the selection reaches the shared workspace state.
 */
export type TaskWorkspaceScope = { ready: boolean; blockedReason: string | null };

export const useTaskWorkspaceScope = (
  workspaceId: string,
  { selectOnFocus }: { selectOnFocus: boolean },
): TaskWorkspaceScope => {
  const { selectedWorkspace, selectWorkspace } = useMobileWorkspaces();
  const { activeWorkspace } = useActiveWorkspaceContext();
  const selectedId = selectedWorkspace?.workspaceId ?? null;
  useFocusEffect(
    useCallback(() => {
      if (selectOnFocus && selectedId !== workspaceId) selectWorkspace(workspaceId);
    }, [selectOnFocus, selectWorkspace, selectedId, workspaceId]),
  );
  const ready = activeWorkspace?.workspaceId === workspaceId;
  return {
    ready,
    blockedReason: ready
      ? null
      : "Selecting the workspace of this task. Actions are available next.",
  };
};
