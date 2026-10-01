import { createContext, useSyncExternalStore } from "react";
import type {
  WorkspaceActivityObserver,
  WorkspaceSessionLiveSnapshot,
} from "@/features/workspace-activity/workspace-activity-observer";
import type { WorkspaceActivityState } from "@/features/workspace-activity/workspace-activity-state";
import { useRequiredContext } from "@/state/app-state-contexts";
import type { WorkspaceActivityProjection } from "@/features/workspace-activity/workspace-activity-projection";

export const WorkspaceActivityContext = createContext<WorkspaceActivityObserver | null>(null);

export const useWorkspaceActivity = (workspaceId: string): WorkspaceActivityState => {
  const observer = useRequiredContext(WorkspaceActivityContext, "useWorkspaceActivity");
  return useSyncExternalStore(
    observer.subscribe,
    () => observer.getWorkspaceActivity(workspaceId),
    () => observer.getWorkspaceActivity(workspaceId),
  );
};

/** Read the live facts of the open workspaces from the one observer that watches all of them. */
export const useWorkspaceSessionLiveSnapshot = (): WorkspaceSessionLiveSnapshot => {
  const observer = useRequiredContext(WorkspaceActivityContext, "useWorkspaceSessionLiveSnapshot");
  return useSyncExternalStore(
    observer.subscribe,
    observer.getSessionLiveSnapshot,
    observer.getSessionLiveSnapshot,
  );
};

/** Preview details use the same live observer as the rail and sidebar. */
export const useWorkspaceActivityProjection = (
  workspaceId: string,
): WorkspaceActivityProjection | null => {
  const observer = useRequiredContext(WorkspaceActivityContext, "useWorkspaceActivityProjection");
  return useSyncExternalStore(
    observer.subscribe,
    () => observer.getWorkspaceProjection(workspaceId),
    () => observer.getWorkspaceProjection(workspaceId),
  );
};
