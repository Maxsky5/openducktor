import type {
  IncompleteWorkspaceRemoval,
  WorkspaceCatalog,
  WorkspaceLifecycleTargetInput,
  WorkspacePathResolution,
  WorkspaceRecord,
  WorkspaceRemovalInput,
} from "@openducktor/contracts";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { ActiveWorkspace, WorkspaceSelectionOperationsInput } from "@/types/state-slices";
import {
  dropWorkspaceQueries,
  invalidateWorkspaceCaches,
  invalidateWorkspaceSettingsSnapshot,
  loadWorkspaceListFromQuery,
  workspaceCatalogQueryOptions,
  workspaceListQueryOptions,
  writeWorkspaceCatalogToQuery,
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
  closedWorkspaces: WorkspaceRecord[];
  incompleteRemovals: IncompleteWorkspaceRemoval[];
  hasLoadedWorkspaceList: boolean;
  isLoadingWorkspaces: boolean;
  workspaceLoadError: Error | null;
  isSwitchingWorkspace: boolean;
  refreshWorkspaces: () => Promise<void>;
  addWorkspace: (input: WorkspaceSelectionOperationsInput) => Promise<void>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  closeWorkspace: (input: WorkspaceLifecycleTargetInput) => Promise<void>;
  removeWorkspace: (input: WorkspaceRemovalInput) => Promise<void>;
  reopenWorkspace: (input: WorkspaceLifecycleTargetInput) => Promise<void>;
  resolveWorkspacePath: (repoPath: string) => Promise<WorkspacePathResolution>;
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

const refreshAfterRemovalFailure = async (queryClient: QueryClient): Promise<void> => {
  try {
    await invalidateWorkspaceCaches(queryClient);
  } catch (error) {
    toast.error("Workspace removal failed, and workspace refresh also failed", {
      description: errorMessage(error),
    });
  }
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
  const workspaceLifecycleInFlightRef = useRef(false);
  const activeWorkspaceRef = useRef(activeWorkspace);
  const workspaceListQuery = useQuery(workspaceListQueryOptions(hostClient));
  const workspaceCatalogQuery = useQuery(workspaceCatalogQueryOptions(hostClient));
  const workspaces = workspaceListQuery.data ?? [];
  const closedWorkspaces = workspaceCatalogQuery.data?.closedWorkspaces ?? [];
  const incompleteRemovals = workspaceCatalogQuery.data?.incompleteRemovals ?? [];
  const workspaceQueryError = workspaceListQuery.error ?? workspaceCatalogQuery.error;
  const workspaceLoadError = workspaceQueryError
    ? new Error(errorMessage(workspaceQueryError), { cause: workspaceQueryError })
    : null;
  const workspacesRef = useRef(workspaces);

  useLayoutEffect(() => {
    activeWorkspaceRef.current = activeWorkspace;
    workspacesRef.current = workspaceListQuery.data ?? [];
  }, [activeWorkspace, workspaceListQuery.data]);

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

  const applyLifecycleCatalog = useCallback(
    (catalog: WorkspaceCatalog): void => {
      writeWorkspaceCatalogToQuery(queryClient, catalog);
      writeWorkspaceRecords(catalog.openWorkspaces);
      const selected = catalog.openWorkspaces.find((workspace) => workspace.isActive) ?? null;
      if (selected?.repoPath !== activeWorkspaceRef.current?.repoPath) {
        clearStateForWorkspaceTransition(selected);
      }
      setActiveWorkspace(selected);
    },
    [clearStateForWorkspaceTransition, queryClient, setActiveWorkspace, writeWorkspaceRecords],
  );

  useLayoutEffect(() => {
    if (!workspaceListQuery.data) {
      return;
    }

    applyActiveWorkspaceFromRecords(workspaceListQuery.data);
  }, [applyActiveWorkspaceFromRecords, workspaceListQuery.data]);

  useEffect(() => {
    if (!workspaceQueryError) {
      return;
    }

    toast.error("Workspace load failed", {
      description: errorMessage(workspaceQueryError),
    });
  }, [workspaceQueryError]);

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
        toast.error("Failed to reorder repositories", {
          description: errorMessage(error),
        });

        if (workspaceReorderVersionRef.current === reorderVersion) {
          if (optimisticRecords) {
            writeWorkspaceRecords(previousRecords);
            const selectedWorkspace = resolveActiveWorkspaceFromRecords({
              records: previousRecords,
              activeWorkspace: activeWorkspaceRef.current,
            });
            setActiveWorkspace(selectedWorkspace);
          }
          return;
        }

        try {
          applyWorkspaceRecords(
            await queryClient.fetchQuery({
              ...workspaceListQueryOptions(hostClient),
              staleTime: 0,
            }),
          );
        } catch (refreshError) {
          toast.error("Failed to reorder repositories, and workspace reload also failed", {
            description: errorMessage(refreshError),
          });
        }
      }
    },
    [applyWorkspaceRecords, hostClient, queryClient, setActiveWorkspace, writeWorkspaceRecords],
  );

  const refreshWorkspaces = useCallback(async (): Promise<void> => {
    const [data] = await Promise.all([
      loadWorkspaceListFromQuery(queryClient, hostClient),
      queryClient.fetchQuery(workspaceCatalogQueryOptions(hostClient)),
    ]);
    applyWorkspaceRecords(data);
  }, [applyWorkspaceRecords, hostClient, queryClient]);

  const addWorkspace = useCallback(
    async (input: WorkspaceSelectionOperationsInput): Promise<void> => {
      const normalizedRepoPath = normalizeRepoPath(input.repoPath);
      if (!normalizedRepoPath) {
        return;
      }

      const workspaceInput: WorkspaceSelectionOperationsInput = {
        workspaceId: input.workspaceId,
        workspaceName: input.workspaceName,
        repoPath: normalizedRepoPath,
      };
      if (input.abbreviation) {
        workspaceInput.abbreviation = input.abbreviation;
      }
      if (input.tileColor) {
        workspaceInput.tileColor = input.tileColor;
      }
      const workspace = await hostClient.workspaceAdd(workspaceInput);
      applyWorkspaceRecord(workspace);
      await invalidateWorkspaceSettingsSnapshot(queryClient);
      toast.success("Repository added", {
        description: workspace.repoPath,
      });
    },
    [applyWorkspaceRecord, hostClient, queryClient],
  );

  const selectWorkspace = useCallback(
    async (workspaceId: string): Promise<void> => {
      const switchVersion = ++workspaceSwitchVersionRef.current;
      workspaceReorderVersionRef.current += 1;

      setIsSwitchingWorkspace(true);

      try {
        const selectedWorkspace = await hostClient.workspaceSelect(workspaceId);

        if (workspaceSwitchVersionRef.current === switchVersion) {
          applyWorkspaceRecord(selectedWorkspace);
        }
      } catch (error) {
        if (workspaceSwitchVersionRef.current === switchVersion) {
          toast.error("Failed to switch repository", {
            description: errorMessage(error),
          });
          throw error;
        }
      } finally {
        if (workspaceSwitchVersionRef.current === switchVersion) {
          setIsSwitchingWorkspace(false);
        }
      }
    },
    [applyWorkspaceRecord, hostClient],
  );

  const runLifecycleAction = useCallback(
    async (run: () => Promise<{ title: string; description: string }>): Promise<void> => {
      if (workspaceLifecycleInFlightRef.current) {
        throw new Error("A workspace action is already in progress. Wait for it to finish.");
      }
      workspaceLifecycleInFlightRef.current = true;
      workspaceSwitchVersionRef.current += 1;
      workspaceReorderVersionRef.current += 1;
      setIsSwitchingWorkspace(true);
      try {
        const success = await run();
        try {
          await invalidateWorkspaceSettingsSnapshot(queryClient);
        } catch (error) {
          toast.error("Workspace changed, but settings refresh failed", {
            description: errorMessage(error),
          });
        }
        toast.success(success.title, { description: success.description });
      } finally {
        workspaceLifecycleInFlightRef.current = false;
        setIsSwitchingWorkspace(false);
      }
    },
    [queryClient],
  );

  const closeWorkspace = useCallback(
    (input: WorkspaceLifecycleTargetInput): Promise<void> =>
      runLifecycleAction(async () => {
        const catalog = await hostClient.workspaceClose(input.workspaceId, input.expectedRepoPath);
        applyLifecycleCatalog(catalog);
        return {
          title: "Workspace closed",
          description: "Reopen it from Open a Repository when you need it again.",
        };
      }),
    [applyLifecycleCatalog, hostClient, runLifecycleAction],
  );

  const removeWorkspace = useCallback(
    (input: WorkspaceRemovalInput): Promise<void> => {
      const remove = async (): Promise<{ title: string; description: string }> => {
        try {
          const result = await hostClient.workspaceRemove(input);
          applyLifecycleCatalog(result.catalog);
          dropWorkspaceQueries(queryClient, {
            repoPath: input.expectedRepoPath,
            workspaceId: input.workspaceId,
          });
          const removedWorktreeCount = result.removedWorktrees.length;
          return {
            title: "Workspace removed",
            description:
              removedWorktreeCount > 0
                ? `Removed ${removedWorktreeCount} task worktree(s). The repository and its branches remain.`
                : "The repository and its branches remain.",
          };
        } catch (error) {
          await refreshAfterRemovalFailure(queryClient);
          throw error;
        }
      };
      return runLifecycleAction(remove);
    },
    [applyLifecycleCatalog, hostClient, queryClient, runLifecycleAction],
  );

  const reopenWorkspace = useCallback(
    (input: WorkspaceLifecycleTargetInput): Promise<void> =>
      runLifecycleAction(async () => {
        const catalog = await hostClient.workspaceReopen(input.workspaceId, input.expectedRepoPath);
        applyLifecycleCatalog(catalog);
        return { title: "Workspace reopened", description: input.expectedRepoPath };
      }),
    [applyLifecycleCatalog, hostClient, runLifecycleAction],
  );

  const resolveWorkspacePath = useCallback(
    (repoPath: string): Promise<WorkspacePathResolution> =>
      hostClient.workspaceResolvePath(repoPath),
    [hostClient],
  );

  return {
    workspaces,
    closedWorkspaces,
    incompleteRemovals,
    hasLoadedWorkspaceList:
      workspaceListQuery.data !== undefined && workspaceCatalogQuery.data !== undefined,
    isLoadingWorkspaces: workspaceListQuery.isPending || workspaceCatalogQuery.isPending,
    workspaceLoadError,
    isSwitchingWorkspace,
    refreshWorkspaces,
    addWorkspace,
    selectWorkspace,
    closeWorkspace,
    removeWorkspace,
    reopenWorkspace,
    resolveWorkspacePath,
    reorderWorkspaces,
    applyWorkspaceRecords,
    applyWorkspaceRecord,
  };
}
