import type {
  IncompleteWorkspaceRemoval,
  WorkspaceCatalog,
  WorkspacePathResolution,
  WorkspaceRecord,
} from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type {
  ActiveWorkspace,
  WorkspaceLifecycleTarget,
  WorkspaceRemovalInput,
  WorkspaceSelectionOperationsInput,
} from "@/types/state-slices";
import {
  dropWorkspaceQueries,
  loadWorkspaceCatalogFromQuery,
  loadWorkspaceListFromQuery,
  markWorkspaceCachesChanged,
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
  onboardingCompleted: boolean;
  hasLoadedWorkspaceList: boolean;
  isLoadingWorkspaces: boolean;
  workspaceLoadError: Error | null;
  isSwitchingWorkspace: boolean;
  refreshWorkspaces: () => Promise<void>;
  addWorkspace: (input: WorkspaceSelectionOperationsInput) => Promise<void>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  closeWorkspace: (input: { workspaceId: string; expectedRepoPath: string }) => Promise<void>;
  removeWorkspace: (input: {
    workspaceId: string;
    expectedRepoPath: string;
    removeTaskWorktrees: boolean;
  }) => Promise<void>;
  reopenWorkspace: (input: { workspaceId: string; expectedRepoPath: string }) => Promise<void>;
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
  const workspaceCatalogQuery = useQuery(workspaceCatalogQueryOptions(hostClient));
  const workspaces = workspaceListQuery.data ?? [];
  const closedWorkspaces = workspaceCatalogQuery.data?.closedWorkspaces ?? [];
  const incompleteRemovals = workspaceCatalogQuery.data?.incompleteRemovals ?? [];
  const onboardingCompleted = workspaceCatalogQuery.data?.onboardingCompleted ?? false;
  const workspaceQueryError = workspaceListQuery.error ?? workspaceCatalogQuery.error;
  const workspaceLoadError = workspaceQueryError
    ? new Error(errorMessage(workspaceQueryError), { cause: workspaceQueryError })
    : null;
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
    const [data] = await Promise.all([
      loadWorkspaceListFromQuery(queryClient, hostClient),
      loadWorkspaceCatalogFromQuery(queryClient, hostClient),
    ]);
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

      const workspaceInput: WorkspaceSelectionOperationsInput = {
        workspaceId: input.workspaceId,
        workspaceName: input.workspaceName,
        repoPath: normalizedRepoPath,
      };
      if (input.defaultRuntimeKind) {
        workspaceInput.defaultRuntimeKind = input.defaultRuntimeKind;
      }
      const workspace = await hostClient.workspaceAdd(workspaceInput);
      applyWorkspaceRecord(workspace);
      await refreshWorkspaceCachesAfterMutation();
      toast.success("Repository added", {
        description: workspace.repoPath,
      });
    },
    [applyWorkspaceRecord, hostClient, refreshWorkspaceCachesAfterMutation],
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

  const runLifecycleAction = useCallback(
    async (
      run: () => Promise<void>,
      success: () => { title: string; description: string },
    ): Promise<void> => {
      workspaceSwitchVersionRef.current += 1;
      workspaceReorderVersionRef.current += 1;
      setIsSwitchingWorkspace(true);
      try {
        try {
          await run();
        } catch (cause) {
          await refreshWorkspaceCachesAfterMutation().catch(() => undefined);
          throw cause;
        }
        await refreshWorkspaceCachesAfterMutation();
        const { title, description } = success();
        toast.success(title, { description });
      } finally {
        setIsSwitchingWorkspace(false);
      }
    },
    [refreshWorkspaceCachesAfterMutation],
  );

  const closeWorkspace = useCallback(
    (input: WorkspaceLifecycleTarget): Promise<void> =>
      runLifecycleAction(
        async () => {
          const catalog = await hostClient.workspaceClose(
            input.workspaceId,
            input.expectedRepoPath,
          );
          applyLifecycleCatalog(catalog);
        },
        () => ({
          title: "Workspace closed",
          description: "Reopen it from Open a Repository when you need it again.",
        }),
      ),
    [applyLifecycleCatalog, hostClient, runLifecycleAction],
  );

  const removeWorkspace = useCallback(
    (input: WorkspaceRemovalInput): Promise<void> => {
      let removedWorktreeCount = 0;
      return runLifecycleAction(
        async () => {
          const result = await hostClient.workspaceRemove(input);
          removedWorktreeCount = result.removedWorktrees.length;
          applyLifecycleCatalog(result.catalog);
          dropWorkspaceQueries(queryClient, {
            repoPath: input.expectedRepoPath,
            workspaceId: input.workspaceId,
          });
        },
        () => ({
          title: "Workspace removed",
          description:
            removedWorktreeCount > 0
              ? `Removed ${removedWorktreeCount} task worktree(s). The repository and its branches remain.`
              : "The repository and its branches remain.",
        }),
      );
    },
    [applyLifecycleCatalog, hostClient, queryClient, runLifecycleAction],
  );

  const reopenWorkspace = useCallback(
    (input: WorkspaceLifecycleTarget): Promise<void> =>
      runLifecycleAction(
        async () => {
          const catalog = await hostClient.workspaceReopen(
            input.workspaceId,
            input.expectedRepoPath,
          );
          applyLifecycleCatalog(catalog);
        },
        () => ({ title: "Workspace reopened", description: input.expectedRepoPath }),
      ),
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
    onboardingCompleted,
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
