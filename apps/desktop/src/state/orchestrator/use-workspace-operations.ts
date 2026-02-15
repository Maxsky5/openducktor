import { errorMessage } from "@/state/orchestrator-helpers";
import type { WorkspaceRecord } from "@openblueprint/contracts";
import { useCallback, useRef, useState } from "react";
import { host } from "./host";

type UseWorkspaceOperationsArgs = {
  activeRepo: string | null;
  setActiveRepo: (repoPath: string | null) => void;
  setStatusText: (value: string) => void;
  setSelectedTaskId: (taskId: string | null) => void;
  clearTaskData: () => void;
  clearActiveBeadsCheck: () => void;
};

type UseWorkspaceOperationsResult = {
  workspaces: WorkspaceRecord[];
  isSwitchingWorkspace: boolean;
  switchingRepoPath: string | null;
  refreshWorkspaces: () => Promise<void>;
  addWorkspace: (repoPath: string) => Promise<void>;
  selectWorkspace: (repoPath: string) => Promise<void>;
};

export function useWorkspaceOperations({
  activeRepo,
  setActiveRepo,
  setStatusText,
  setSelectedTaskId,
  clearTaskData,
  clearActiveBeadsCheck,
}: UseWorkspaceOperationsArgs): UseWorkspaceOperationsResult {
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);
  const [switchingRepoPath, setSwitchingRepoPath] = useState<string | null>(null);
  const workspaceSwitchVersionRef = useRef(0);

  const refreshWorkspaces = useCallback(async (): Promise<void> => {
    const data = await host.workspaceList();
    setWorkspaces(data);
    const active = data.find((entry) => entry.isActive);
    setActiveRepo(active?.path ?? null);
  }, [setActiveRepo]);

  const addWorkspace = useCallback(
    async (repoPath: string): Promise<void> => {
      if (!repoPath.trim()) {
        return;
      }

      const workspace = await host.workspaceAdd(repoPath.trim());
      setStatusText(`Workspace added: ${workspace.path}`);
      await refreshWorkspaces();
    },
    [refreshWorkspaces, setStatusText],
  );

  const selectWorkspace = useCallback(
    async (repoPath: string): Promise<void> => {
      const previousRepo = activeRepo;
      const switchVersion = ++workspaceSwitchVersionRef.current;

      setSelectedTaskId(null);
      setActiveRepo(repoPath);
      clearTaskData();
      clearActiveBeadsCheck();
      setIsSwitchingWorkspace(true);
      setSwitchingRepoPath(repoPath);
      setStatusText(`Switching repository to ${repoPath}...`);

      try {
        await host.workspaceSelect(repoPath);
        if (workspaceSwitchVersionRef.current !== switchVersion) {
          return;
        }
        setStatusText(`Workspace selected: ${repoPath}`);
        await refreshWorkspaces();
      } catch (error) {
        if (workspaceSwitchVersionRef.current !== switchVersion) {
          return;
        }
        setStatusText(`Failed to switch workspace: ${errorMessage(error)}`);
        setIsSwitchingWorkspace(false);
        setSwitchingRepoPath(null);
        setActiveRepo(previousRepo ?? null);
        throw error;
      } finally {
        if (workspaceSwitchVersionRef.current === switchVersion) {
          setIsSwitchingWorkspace(false);
          setSwitchingRepoPath(null);
        }
      }
    },
    [
      activeRepo,
      clearTaskData,
      clearActiveBeadsCheck,
      refreshWorkspaces,
      setActiveRepo,
      setSelectedTaskId,
      setStatusText,
    ],
  );

  return {
    workspaces,
    isSwitchingWorkspace,
    switchingRepoPath,
    refreshWorkspaces,
    addWorkspace,
    selectWorkspace,
  };
}
