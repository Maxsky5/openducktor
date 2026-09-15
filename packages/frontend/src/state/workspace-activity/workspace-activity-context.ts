import { createContext, useSyncExternalStore } from "react";
import type { WorkspaceActivityObserver } from "@/features/workspace-activity/workspace-activity-observer";
import type { WorkspaceActivityState } from "@/features/workspace-activity/workspace-activity-state";
import { useRequiredContext } from "@/state/app-state-contexts";

export const WorkspaceActivityContext = createContext<WorkspaceActivityObserver | null>(null);

export const useWorkspaceActivity = (workspaceId: string): WorkspaceActivityState => {
  const observer = useRequiredContext(WorkspaceActivityContext, "useWorkspaceActivity");
  return useSyncExternalStore(
    observer.subscribe,
    () => observer.getWorkspaceActivity(workspaceId),
    () => observer.getWorkspaceActivity(workspaceId),
  );
};
