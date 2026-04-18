import type { WorkspaceRecord } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { DEFAULT_RUNTIME_KIND } from "@/state/agent-runtime-registry";
import type { ActiveWorkspace, WorkspaceSelectionOperationsInput } from "@/types/state-slices";
import {
  loadRepoConfigFromQuery,
  loadWorkspaceListFromQuery,
  workspaceQueryKeys,
} from "../../queries/workspace";
import { normalizeRepoPath } from "./workspace-operations-model";
import type {
  PreparedRepoSwitchRef,
  WorkspaceSelectionOperationsHostClient,
} from "./workspace-operations-types";

type UseWorkspaceSelectionOperationsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  setActiveWorkspace: (workspace: ActiveWorkspace | null) => void;
  clearTaskData: () => void;
  clearActiveBeadsCheck: () => void;
  clearBranchData: () => void;
  hostClient: WorkspaceSelectionOperationsHostClient;
  preparedRepoSwitchRef: PreparedRepoSwitchRef;
};

type UseWorkspaceSelectionOperationsResult = {
  workspaces: WorkspaceRecord[];
  isSwitchingWorkspace: boolean;
  refreshWorkspaces: () => Promise<void>;
  addWorkspace: (input: WorkspaceSelectionOperationsInput) => Promise<void>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  applyWorkspaceRecords: (records: WorkspaceRecord[]) => void;
  applyWorkspaceRecord: (record: WorkspaceRecord) => void;
};

const resolveActiveWorkspaceFromRecords = ({
  records,
  activeWorkspace,
}: {
  records: WorkspaceRecord[];
  activeWorkspace: ActiveWorkspace | null;
}): WorkspaceRecord | ActiveWorkspace | null => {
  const activeRecord = records.find((entry) => entry.isActive);
  if (activeRecord) {
    return activeRecord;
  }

  if (!activeWorkspace) {
    return null;
  }

  return (
    records.find((entry) => entry.workspaceId === activeWorkspace.workspaceId) ??
    records.find((entry) => entry.repoPath === activeWorkspace.repoPath) ??
    activeWorkspace
  );
};

export function useWorkspaceSelectionOperations({
  activeWorkspace,
  setActiveWorkspace,
  clearTaskData,
  clearActiveBeadsCheck,
  clearBranchData,
  hostClient,
  preparedRepoSwitchRef,
}: UseWorkspaceSelectionOperationsArgs): UseWorkspaceSelectionOperationsResult {
  const queryClient = useQueryClient();
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);
  const workspaceSwitchVersionRef = useRef(0);
  const activeWorkspaceRef = useRef(activeWorkspace);

  activeWorkspaceRef.current = activeWorkspace;

  const markWorkspaceActiveLocally = useCallback((workspaceId: string): void => {
    setWorkspaces((current) => {
      let hasMatch = false;
      const next = current.map((workspace) => {
        const isActive = workspace.workspaceId === workspaceId;
        hasMatch ||= isActive;

        if (workspace.isActive === isActive) {
          return workspace;
        }

        return {
          ...workspace,
          isActive,
        };
      });

      return hasMatch ? next : current;
    });
  }, []);

  const applyWorkspaceRecords = useCallback(
    (records: WorkspaceRecord[]): void => {
      setWorkspaces(records);
      const selectedWorkspace = resolveActiveWorkspaceFromRecords({
        records,
        activeWorkspace: activeWorkspaceRef.current,
      });
      setActiveWorkspace(selectedWorkspace);
    },
    [setActiveWorkspace],
  );

  const applyWorkspaceRecord = useCallback(
    (record: WorkspaceRecord): void => {
      setWorkspaces((current) => {
        const next = current
          .filter((entry) => entry.workspaceId !== record.workspaceId)
          .map((entry) => {
            if (!record.isActive || !entry.isActive) {
              return entry;
            }

            return {
              ...entry,
              isActive: false,
            };
          });
        next.push(record);
        next.sort((left, right) => left.workspaceName.localeCompare(right.workspaceName));
        return next;
      });

      if (record.isActive) {
        setActiveWorkspace(record);
      }
    },
    [setActiveWorkspace],
  );

  const refreshWorkspaces = useCallback(async (): Promise<void> => {
    const data = await loadWorkspaceListFromQuery(queryClient, hostClient);
    applyWorkspaceRecords(data);
  }, [applyWorkspaceRecords, hostClient, queryClient]);

  const refreshWorkspaceCachesAfterMutation = useCallback(async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: workspaceQueryKeys.list(),
    });
    queryClient.removeQueries({
      queryKey: workspaceQueryKeys.settingsSnapshot(),
      exact: true,
    });
  }, [queryClient]);

  const addWorkspace = useCallback(
    async (input: WorkspaceSelectionOperationsInput): Promise<void> => {
      const normalizedRepoPath = normalizeRepoPath(input.repoPath);
      if (!normalizedRepoPath) {
        return;
      }

      const workspace = await hostClient.workspaceAdd({
        workspaceId: input.workspaceId,
        workspaceName: input.workspaceName,
        repoPath: normalizedRepoPath,
      });
      await refreshWorkspaceCachesAfterMutation();
      await refreshWorkspaces();
      toast.success("Repository added", {
        description: workspace.repoPath,
      });
    },
    [hostClient, refreshWorkspaceCachesAfterMutation, refreshWorkspaces],
  );

  const selectWorkspace = useCallback(
    async (workspaceId: string): Promise<void> => {
      const switchVersion = ++workspaceSwitchVersionRef.current;
      const previousRepo = activeWorkspaceRef.current?.repoPath ?? null;

      setIsSwitchingWorkspace(true);

      try {
        const selectedWorkspace = await hostClient.workspaceSelect(workspaceId);
        await refreshWorkspaceCachesAfterMutation();

        if (workspaceSwitchVersionRef.current !== switchVersion) {
          return;
        }

        clearTaskData();
        clearActiveBeadsCheck();
        clearBranchData();
        preparedRepoSwitchRef.current = {
          previousRepo,
          nextRepo: selectedWorkspace.repoPath,
        };
        setActiveWorkspace(selectedWorkspace);

        void loadRepoConfigFromQuery(queryClient, selectedWorkspace.workspaceId, hostClient)
          .then((repoConfig) => {
            if (workspaceSwitchVersionRef.current !== switchVersion) {
              return;
            }

            return hostClient.runtimeEnsure(
              selectedWorkspace.repoPath,
              repoConfig?.defaultRuntimeKind ?? DEFAULT_RUNTIME_KIND,
            );
          })
          .catch((error) => {
            if (workspaceSwitchVersionRef.current !== switchVersion) {
              return;
            }

            toast.error("Runtime unavailable", {
              description: errorMessage(error),
            });
          });

        if (workspaceSwitchVersionRef.current !== switchVersion) {
          return;
        }

        try {
          await refreshWorkspaces();
        } catch (error) {
          if (workspaceSwitchVersionRef.current !== switchVersion) {
            return;
          }

          markWorkspaceActiveLocally(selectedWorkspace.workspaceId);
          toast.error("Repository switched, but workspace refresh failed", {
            description: errorMessage(error),
          });
        }
      } catch (error) {
        if (workspaceSwitchVersionRef.current !== switchVersion) {
          return;
        }

        toast.error("Failed to switch repository", {
          description: errorMessage(error),
        });
        setIsSwitchingWorkspace(false);
        throw error;
      } finally {
        if (workspaceSwitchVersionRef.current === switchVersion) {
          setIsSwitchingWorkspace(false);
        }
      }
    },
    [
      clearActiveBeadsCheck,
      clearBranchData,
      clearTaskData,
      hostClient,
      markWorkspaceActiveLocally,
      preparedRepoSwitchRef,
      queryClient,
      refreshWorkspaceCachesAfterMutation,
      refreshWorkspaces,
      setActiveWorkspace,
    ],
  );

  return {
    workspaces,
    isSwitchingWorkspace,
    refreshWorkspaces,
    addWorkspace,
    selectWorkspace,
    applyWorkspaceRecords,
    applyWorkspaceRecord,
  };
}
