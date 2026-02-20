import { errorMessage } from "@/lib/errors";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { host } from "./host";

type UseWorkspaceOperationsArgs = {
  activeRepo: string | null;
  setActiveRepo: (repoPath: string | null) => void;
  clearTaskData: () => void;
  clearActiveBeadsCheck: () => void;
};

type UseWorkspaceOperationsResult = {
  workspaces: WorkspaceRecord[];
  isSwitchingWorkspace: boolean;
  refreshWorkspaces: () => Promise<void>;
  addWorkspace: (repoPath: string) => Promise<void>;
  selectWorkspace: (repoPath: string) => Promise<void>;
};

export function useWorkspaceOperations({
  activeRepo,
  setActiveRepo,
  clearTaskData,
  clearActiveBeadsCheck,
}: UseWorkspaceOperationsArgs): UseWorkspaceOperationsResult {
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);
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
      await refreshWorkspaces();
      toast.success("Repository added", {
        description: workspace.path,
      });
    },
    [refreshWorkspaces],
  );

  const selectWorkspace = useCallback(
    async (repoPath: string): Promise<void> => {
      const previousRepo = activeRepo;
      const switchVersion = ++workspaceSwitchVersionRef.current;

      setActiveRepo(repoPath);
      clearTaskData();
      clearActiveBeadsCheck();
      setIsSwitchingWorkspace(true);

      try {
        await host.workspaceSelect(repoPath);
        await host.opencodeRepoRuntimeEnsure(repoPath).catch((error) => {
          toast.error("OpenCode server unavailable", {
            description: errorMessage(error),
          });
        });
        if (workspaceSwitchVersionRef.current !== switchVersion) {
          return;
        }
        await refreshWorkspaces();
      } catch (error) {
        if (workspaceSwitchVersionRef.current !== switchVersion) {
          return;
        }
        toast.error("Failed to switch repository", {
          description: errorMessage(error),
        });
        setIsSwitchingWorkspace(false);
        setActiveRepo(previousRepo ?? null);
        throw error;
      } finally {
        if (workspaceSwitchVersionRef.current === switchVersion) {
          setIsSwitchingWorkspace(false);
        }
      }
    },
    [activeRepo, clearTaskData, clearActiveBeadsCheck, refreshWorkspaces, setActiveRepo],
  );

  return {
    workspaces,
    isSwitchingWorkspace,
    refreshWorkspaces,
    addWorkspace,
    selectWorkspace,
  };
}
