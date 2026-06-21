import type { WorkspaceRecord } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { ActiveWorkspace, WorkspaceSelectionOperationsInput } from "@/types/state-slices";
import {
  loadWorkspaceListFromQuery,
  markWorkspaceCachesChanged,
  workspaceListQueryOptions,
  writeWorkspaceListToQuery,
} from "../../queries/workspace";
import {
  normalizeRepoPath,
  shouldResetBranchStateForRepoChange,
} from "./workspace-operations-model";
import type { WorkspaceSelectionOperationsHostClient } from "./workspace-operations-types";

type UseWorkspaceSelectionOperationsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  setActiveWorkspace: (workspace: ActiveWorkspace | null) => void;
  clearTaskData: () => void;
  clearActiveTaskStoreCheck: () => void;
  clearBranchData: (repoPath?: string | null) => void;
  hostClient: WorkspaceSelectionOperationsHostClient;
};

type UseWorkspaceSelectionOperationsResult = {
  workspaces: WorkspaceRecord[];
  isSwitchingWorkspace: boolean;
  refreshWorkspaces: () => Promise<void>;
  addWorkspace: (input: WorkspaceSelectionOperationsInput) => Promise<void>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  reorderWorkspaces: (workspaceIds: string[]) => Promise<void>;
  applyWorkspaceRecords: (records: WorkspaceRecord[]) => void;
  applyWorkspaceRecord: (record: WorkspaceRecord) => void;
};

const orderWorkspaceRecords = (
  records: WorkspaceRecord[],
  workspaceIds: string[],
): WorkspaceRecord[] | null => {
  if (records.length !== workspaceIds.length) {
    return null;
  }

  if (new Set(workspaceIds).size !== workspaceIds.length) {
    return null;
  }

  const recordsById = new Map(records.map((record) => [record.workspaceId, record]));
  if (recordsById.size !== records.length) {
    return null;
  }

  const orderedRecords = workspaceIds.reduce<WorkspaceRecord[]>((ordered, workspaceId) => {
    const record = recordsById.get(workspaceId);
    if (record) {
      ordered.push(record);
    }
    return ordered;
  }, []);

  if (orderedRecords.length !== records.length) {
    return null;
  }

  return orderedRecords;
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
  clearActiveTaskStoreCheck,
  clearBranchData,
  hostClient,
}: UseWorkspaceSelectionOperationsArgs): UseWorkspaceSelectionOperationsResult {
  const queryClient = useQueryClient();
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);
  const workspaceSwitchVersionRef = useRef(0);
  const workspaceReorderVersionRef = useRef(0);
  const activeWorkspaceRef = useRef(activeWorkspace);
  const workspaceListQuery = useQuery(workspaceListQueryOptions(hostClient));
  const workspaces = workspaceListQuery.data ?? [];
  const workspacesRef = useRef(workspaces);

  activeWorkspaceRef.current = activeWorkspace;
  workspacesRef.current = workspaces;

  const writeWorkspaceRecords = useCallback(
    (
      recordsOrUpdater:
        | WorkspaceRecord[]
        | ((current: WorkspaceRecord[] | undefined) => WorkspaceRecord[]),
    ): void => {
      writeWorkspaceListToQuery(queryClient, recordsOrUpdater);
    },
    [queryClient],
  );

  const clearStateForWorkspaceTransition = useCallback(
    (nextWorkspace: ActiveWorkspace | WorkspaceRecord | null): void => {
      const previousRepo = activeWorkspaceRef.current?.repoPath ?? null;
      const nextRepo = nextWorkspace?.repoPath ?? null;

      clearTaskData();
      clearActiveTaskStoreCheck();
      if (shouldResetBranchStateForRepoChange(previousRepo, nextRepo)) {
        clearBranchData(nextRepo);
      }
    },
    [clearActiveTaskStoreCheck, clearBranchData, clearTaskData],
  );

  const markWorkspaceActiveLocally = useCallback(
    (workspaceId: string): void => {
      writeWorkspaceRecords((current = []) => {
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
    },
    [writeWorkspaceRecords],
  );

  const applyActiveWorkspaceFromRecords = useCallback(
    (records: WorkspaceRecord[]): void => {
      const selectedWorkspace = resolveActiveWorkspaceFromRecords({
        records,
        activeWorkspace: activeWorkspaceRef.current,
      });
      if (selectedWorkspace?.repoPath !== activeWorkspaceRef.current?.repoPath) {
        clearStateForWorkspaceTransition(selectedWorkspace);
      }
      setActiveWorkspace(selectedWorkspace);
    },
    [clearStateForWorkspaceTransition, setActiveWorkspace],
  );

  const applyWorkspaceRecords = useCallback(
    (records: WorkspaceRecord[]): void => {
      writeWorkspaceRecords(records);
      applyActiveWorkspaceFromRecords(records);
    },
    [applyActiveWorkspaceFromRecords, writeWorkspaceRecords],
  );

  const applyWorkspaceRecord = useCallback(
    (record: WorkspaceRecord): void => {
      writeWorkspaceRecords((current = []) => {
        const next = current.map((entry) => {
          if (entry.workspaceId === record.workspaceId) {
            return record;
          }

          if (!record.isActive || !entry.isActive) {
            return entry;
          }

          return {
            ...entry,
            isActive: false,
          };
        });

        if (next.some((entry) => entry.workspaceId === record.workspaceId)) {
          return next;
        }

        return [...next, record];
      });

      if (record.isActive) {
        if (record.repoPath !== activeWorkspaceRef.current?.repoPath) {
          clearStateForWorkspaceTransition(record);
        }
        setActiveWorkspace(record);
      }
    },
    [clearStateForWorkspaceTransition, setActiveWorkspace, writeWorkspaceRecords],
  );

  useLayoutEffect(() => {
    if (!workspaceListQuery.data) {
      return;
    }

    applyActiveWorkspaceFromRecords(workspaceListQuery.data);
  }, [applyActiveWorkspaceFromRecords, workspaceListQuery.data]);

  useEffect(() => {
    if (!workspaceListQuery.error) {
      return;
    }

    toast.error("Workspace load failed", {
      description: errorMessage(workspaceListQuery.error),
    });
  }, [workspaceListQuery.error]);

  const reorderWorkspaces = useCallback(
    async (workspaceIds: string[]): Promise<void> => {
      const reorderVersion = ++workspaceReorderVersionRef.current;
      const previousRecords = workspacesRef.current;
      const optimisticRecords = orderWorkspaceRecords(previousRecords, workspaceIds);

      if (optimisticRecords) {
        writeWorkspaceRecords(optimisticRecords);
      }

      try {
        const records = await hostClient.workspaceReorder(workspaceIds);

        if (workspaceReorderVersionRef.current === reorderVersion) {
          applyWorkspaceRecords(records);
        }
      } catch (error) {
        if (workspaceReorderVersionRef.current === reorderVersion) {
          if (optimisticRecords) {
            writeWorkspaceRecords(previousRecords);
            const selectedWorkspace = resolveActiveWorkspaceFromRecords({
              records: previousRecords,
              activeWorkspace: activeWorkspaceRef.current,
            });
            setActiveWorkspace(selectedWorkspace);
          }

          toast.error("Failed to reorder repositories", {
            description: errorMessage(error),
          });
          throw error;
        }
      }
    },
    [applyWorkspaceRecords, hostClient, setActiveWorkspace, writeWorkspaceRecords],
  );

  const refreshWorkspaces = useCallback(async (): Promise<void> => {
    const data = await loadWorkspaceListFromQuery(queryClient, hostClient);
    applyWorkspaceRecords(data);
  }, [applyWorkspaceRecords, hostClient, queryClient]);

  const refreshWorkspaceCachesAfterMutation = useCallback(async (): Promise<void> => {
    await markWorkspaceCachesChanged(queryClient);
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
      await Promise.all([refreshWorkspaceCachesAfterMutation(), refreshWorkspaces()]);
      toast.success("Repository added", {
        description: workspace.repoPath,
      });
    },
    [hostClient, refreshWorkspaceCachesAfterMutation, refreshWorkspaces],
  );

  const selectWorkspace = useCallback(
    async (workspaceId: string): Promise<void> => {
      const switchVersion = ++workspaceSwitchVersionRef.current;
      workspaceReorderVersionRef.current += 1;

      setIsSwitchingWorkspace(true);

      try {
        const selectedWorkspace = await hostClient.workspaceSelect(workspaceId);
        await refreshWorkspaceCachesAfterMutation();

        if (workspaceSwitchVersionRef.current === switchVersion) {
          clearStateForWorkspaceTransition(selectedWorkspace);
          setActiveWorkspace(selectedWorkspace);

          try {
            await refreshWorkspaces();
          } catch (error) {
            if (workspaceSwitchVersionRef.current === switchVersion) {
              markWorkspaceActiveLocally(selectedWorkspace.workspaceId);
              toast.error("Repository switched, but workspace refresh failed", {
                description: errorMessage(error),
              });
            }
          }
        }
      } catch (error) {
        if (workspaceSwitchVersionRef.current === switchVersion) {
          toast.error("Failed to switch repository", {
            description: errorMessage(error),
          });
          setIsSwitchingWorkspace(false);
          throw error;
        }
      } finally {
        if (workspaceSwitchVersionRef.current === switchVersion) {
          setIsSwitchingWorkspace(false);
        }
      }
    },
    [
      clearStateForWorkspaceTransition,
      hostClient,
      markWorkspaceActiveLocally,
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
    reorderWorkspaces,
    applyWorkspaceRecords,
    applyWorkspaceRecord,
  };
}
