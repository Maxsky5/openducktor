import type { ExternalTaskSyncEvent, SettingsSnapshot, TaskCard } from "@openducktor/contracts";
import { isCancelledError, type QueryClient } from "@tanstack/react-query";
import { hostClient as host } from "@/lib/host-client";
import { resolveLatestDocumentPayload } from "./document-utils";
import { documentQueryKeys, type TaskDocument, type TaskDocumentSection } from "./documents";
import { invalidateRepoTaskQueries, taskQueryKeys } from "./tasks";
import { workspaceQueryKeys } from "./workspace";

export type TaskViewSyncPorts = {
  loadSettings: () => Promise<SettingsSnapshot>;
  listTasks: (repoPath: string, doneVisibleDays: number) => Promise<TaskCard[]>;
  loadFreshDocument: (
    repoPath: string,
    taskId: string,
    section: TaskDocumentSection,
  ) => Promise<TaskDocument>;
};

export type LocalMutationImpact =
  | { kind: "task-list-only" }
  | { kind: "refresh-documents"; taskIds: string[] }
  | { kind: "remove-documents"; taskIds: string[] };

export type TaskViewSync = {
  loadWorkspace: (repoPath: string) => Promise<void>;
  refreshManually: (repoPath: string) => Promise<void>;
  refreshAfterLocalMutation: (repoPath: string, impact: LocalMutationImpact) => Promise<void>;
  reconcileExternalEvent: (
    event: ExternalTaskSyncEvent,
    activeRepoPath: string | null,
  ) => Promise<void>;
  reconcileStreamSnapshot: (activeRepoPath: string | null) => Promise<void>;
};

const isCancellation = (error: unknown): boolean => isCancelledError(error);

const toEventChanges = (event: ExternalTaskSyncEvent) =>
  event.kind === "external_task_created"
    ? { taskIds: [event.taskId], removedTaskIds: [] }
    : { taskIds: event.taskIds, removedTaskIds: event.removedTaskIds };

const cachedDocumentEntries = (queryClient: QueryClient, repoPath: string) =>
  queryClient
    .getQueryCache()
    .findAll({ queryKey: documentQueryKeys.all, exact: false })
    .flatMap((query) => {
      const [scope, section, cachedRepoPath, taskId] = query.queryKey;
      if (
        scope !== documentQueryKeys.all[0] ||
        cachedRepoPath !== repoPath ||
        typeof taskId !== "string"
      ) {
        return [];
      }
      if (section === "spec" || section === "plan") {
        return [{ queryKey: query.queryKey, section: section as TaskDocumentSection, taskId }];
      }
      if (section === "qa-report") {
        return [{ queryKey: query.queryKey, section: "qa" as const, taskId }];
      }
      return [];
    });

export const createTaskViewSync = ({
  queryClient,
  ports,
}: {
  queryClient: QueryClient;
  ports: TaskViewSyncPorts;
}): TaskViewSync => {
  type ActiveRefresh = {
    promise: Promise<void>;
    successor: Promise<void> | null;
  };
  const activeRefreshes = new Map<string, ActiveRefresh>();

  const loadSettings = async (): Promise<SettingsSnapshot> => {
    const queryKey = workspaceQueryKeys.settingsSnapshot();
    const cached = queryClient.getQueryData<SettingsSnapshot>(queryKey);
    const state = queryClient.getQueryState(queryKey);
    if (
      state?.status === "success" &&
      state.fetchStatus === "idle" &&
      !state.isInvalidated &&
      cached
    ) {
      return cached;
    }
    return queryClient.fetchQuery({ queryKey, queryFn: ports.loadSettings, staleTime: 0 });
  };

  const fetchTasks = async (repoPath: string, doneVisibleDays: number): Promise<TaskCard[]> => {
    const taskData = await queryClient.fetchQuery({
      queryKey: taskQueryKeys.repoData(repoPath, doneVisibleDays),
      queryFn: async () => ({ tasks: await ports.listTasks(repoPath, doneVisibleDays) }),
      staleTime: 0,
    });
    return taskData.tasks;
  };

  const refreshDocumentEntry = async (
    repoPath: string,
    entry: ReturnType<typeof cachedDocumentEntries>[number],
  ): Promise<void> => {
    const { queryKey, section, taskId } = entry;
    await queryClient.fetchQuery({
      queryKey,
      queryFn: async () => {
        const incoming = await ports.loadFreshDocument(repoPath, taskId, section);
        return resolveLatestDocumentPayload(queryClient.getQueryData(queryKey), incoming);
      },
      staleTime: 0,
    });
  };

  const refreshDocumentEntries = async (
    repoPath: string,
    entries: ReturnType<typeof cachedDocumentEntries>,
  ): Promise<void> => {
    await Promise.all(entries.map((entry) => refreshDocumentEntry(repoPath, entry)));
  };

  const refreshSnapshotDocumentEntries = async (
    repoPath: string,
    entries: ReturnType<typeof cachedDocumentEntries>,
  ): Promise<void> => {
    await Promise.all(
      entries.map(async (entry) => {
        try {
          await refreshDocumentEntry(repoPath, entry);
        } catch (error) {
          if (!isCancellation(error)) throw error;
          const successor = activeRefreshes.get(repoPath)?.promise;
          if (!successor) throw error;
          await successor;
        }
      }),
    );
  };

  const refreshDocuments = async (repoPath: string, taskIds: string[]): Promise<void> => {
    const taskIdSet = new Set(taskIds);
    const entries = cachedDocumentEntries(queryClient, repoPath).filter((entry) =>
      taskIdSet.has(entry.taskId),
    );
    await cancelDocuments(repoPath, taskIds);
    await refreshDocumentEntries(repoPath, entries);
  };

  const cancelDocuments = async (repoPath: string, taskIds?: string[]): Promise<void> => {
    const taskIdSet = taskIds ? new Set(taskIds) : null;
    const cancellations: Promise<void>[] = [];
    for (const entry of cachedDocumentEntries(queryClient, repoPath)) {
      if (!taskIdSet || taskIdSet.has(entry.taskId)) {
        cancellations.push(
          queryClient.cancelQueries({ queryKey: entry.queryKey, exact: true }, { silent: true }),
        );
      }
    }
    await Promise.all(cancellations);
  };

  const cancelAllDocuments = (): Promise<void> =>
    queryClient.cancelQueries({ queryKey: documentQueryKeys.all, exact: false }, { silent: true });

  const cancelRepoTaskQueries = (repoPath: string): Promise<void> =>
    queryClient.cancelQueries(
      { queryKey: taskQueryKeys.repoDataPrefix(repoPath), exact: false },
      { silent: true },
    );

  const removeDocuments = (repoPath: string, taskIds: string[]): void => {
    const taskIdSet = new Set(taskIds);
    for (const entry of cachedDocumentEntries(queryClient, repoPath)) {
      if (taskIdSet.has(entry.taskId)) {
        queryClient.removeQueries({ queryKey: entry.queryKey, exact: true });
      }
    }
  };

  const invalidateDocuments = async (repoPath: string, taskIds?: string[]): Promise<void> => {
    const taskIdSet = taskIds ? new Set(taskIds) : null;
    const invalidations: Promise<void>[] = [];
    for (const entry of cachedDocumentEntries(queryClient, repoPath)) {
      if (!taskIdSet || taskIdSet.has(entry.taskId)) {
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: entry.queryKey,
            exact: true,
            refetchType: "none",
          }),
        );
      }
    }
    await Promise.all(invalidations);
  };

  const refreshCachedKanban = async (
    repoPath: string,
    primaryDoneVisibleDays: number,
  ): Promise<void> => {
    const variants = queryClient
      .getQueryCache()
      .findAll({ queryKey: taskQueryKeys.repoDataPrefix(repoPath), exact: false })
      .map((query) => query.queryKey[3])
      .filter(
        (days): days is number =>
          typeof days === "number" && days >= 0 && days !== primaryDoneVisibleDays,
      );
    await Promise.all([...new Set(variants)].map((days) => fetchTasks(repoPath, days)));
  };

  const runActive = (
    repoPath: string,
    operation: (joinWinner: () => Promise<void>) => Promise<void>,
  ) => {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const current = new Promise<void>((nextResolve, nextReject) => {
      resolve = nextResolve;
      reject = nextReject;
    });
    const activeRefresh: ActiveRefresh = { promise: current, successor: null };
    const predecessor = activeRefreshes.get(repoPath);
    if (predecessor) {
      predecessor.successor = current;
    }
    activeRefreshes.set(repoPath, activeRefresh);
    let joinedWinner = false;
    const joinWinner = async (): Promise<void> => {
      const successor = activeRefresh.successor;
      if (!successor) {
        throw new Error(
          `Task view refresh for '${repoPath}' was cancelled without a superseding refresh.`,
        );
      }
      joinedWinner = true;
      await successor;
    };
    void operation(joinWinner)
      .then(
        async () => {
          try {
            if (!joinedWinner && activeRefreshes.get(repoPath) !== activeRefresh) {
              await joinWinner();
            }
            resolve();
          } catch (winnerError) {
            reject(winnerError);
          }
        },
        async (error) => {
          if (activeRefreshes.get(repoPath) !== activeRefresh) {
            try {
              await joinWinner();
              resolve();
            } catch (winnerError) {
              reject(winnerError);
            }
            return;
          }
          reject(error);
        },
      )
      .finally(() => {
        if (activeRefreshes.get(repoPath) === activeRefresh) {
          activeRefreshes.delete(repoPath);
        }
      });
    return current;
  };

  const refreshActive = (
    repoPath: string,
    options: {
      impact: LocalMutationImpact;
      doneVisibleDays?: number;
      refreshKanban: boolean;
      refreshDocumentsFor?: string[];
      prepare?: () => Promise<void>;
    },
  ): Promise<void> =>
    runActive(repoPath, async (joinWinner) => {
      try {
        await options.prepare?.();
        const doneVisibleDays =
          options.doneVisibleDays ?? (await loadSettings()).kanban.doneVisibleDays;
        if (options.impact.kind === "remove-documents") {
          removeDocuments(repoPath, options.impact.taskIds);
        }
        await cancelRepoTaskQueries(repoPath);
        await invalidateRepoTaskQueries(queryClient, repoPath);
        await fetchTasks(repoPath, doneVisibleDays);
        if (options.impact.kind === "refresh-documents") {
          await refreshDocuments(repoPath, options.impact.taskIds);
        }
        if (options.refreshDocumentsFor) {
          await refreshDocuments(repoPath, options.refreshDocumentsFor);
        }
        if (options.refreshKanban) {
          await refreshCachedKanban(repoPath, doneVisibleDays);
        }
      } catch (error) {
        if (isCancellation(error)) {
          await joinWinner();
          return;
        }
        throw error;
      }
    });

  return {
    loadWorkspace: async (repoPath) => {
      const settings = await loadSettings();
      const state = queryClient.getQueryState(
        taskQueryKeys.repoData(repoPath, settings.kanban.doneVisibleDays),
      );
      if (state?.status !== "success") {
        await fetchTasks(repoPath, settings.kanban.doneVisibleDays);
      }
    },
    refreshManually: (repoPath) =>
      activeRefreshes.get(repoPath)?.promise ??
      refreshActive(repoPath, {
        impact: { kind: "task-list-only" },
        refreshKanban: true,
      }),
    refreshAfterLocalMutation: (repoPath, impact) =>
      refreshActive(repoPath, { impact, refreshKanban: true }),
    reconcileExternalEvent: async (event, activeRepoPath) => {
      const { taskIds, removedTaskIds } = toEventChanges(event);
      const removedTaskIdSet = new Set(removedTaskIds);
      const retainedTaskIds: string[] = [];
      for (const taskId of taskIds) {
        if (!removedTaskIdSet.has(taskId)) {
          retainedTaskIds.push(taskId);
        }
      }
      const affectedTaskIds = [...new Set([...taskIds, ...removedTaskIds])];
      if (activeRepoPath !== event.repoPath) {
        await runActive(event.repoPath, async () => {
          await Promise.all([
            cancelDocuments(event.repoPath),
            cancelRepoTaskQueries(event.repoPath),
          ]);
          removeDocuments(event.repoPath, removedTaskIds);
          await Promise.all([
            invalidateRepoTaskQueries(queryClient, event.repoPath),
            invalidateDocuments(event.repoPath),
          ]);
        });
        return;
      }
      await refreshActive(event.repoPath, {
        impact: { kind: "task-list-only" },
        refreshKanban: false,
        refreshDocumentsFor: retainedTaskIds,
        prepare: async () => {
          await Promise.all([
            cancelDocuments(event.repoPath, affectedTaskIds),
            cancelRepoTaskQueries(event.repoPath),
          ]);
          removeDocuments(event.repoPath, removedTaskIds);
          await invalidateDocuments(event.repoPath, retainedTaskIds);
        },
      });
    },
    reconcileStreamSnapshot: async (activeRepoPath) => {
      const activeDocumentEntries = activeRepoPath
        ? cachedDocumentEntries(queryClient, activeRepoPath).filter(
            (entry) =>
              queryClient
                .getQueryCache()
                .find({ queryKey: entry.queryKey, exact: true })
                ?.isActive() === true,
          )
        : [];
      const taskQueries = queryClient
        .getQueryCache()
        .findAll({ queryKey: taskQueryKeys.all, exact: false });
      const repos = new Set(
        taskQueries
          .map((query) => query.queryKey[2])
          .filter((repoPath): repoPath is string => typeof repoPath === "string"),
      );
      const inactiveRepos = [...repos].filter((repoPath) => repoPath !== activeRepoPath);
      const doneVisibleDays = activeRepoPath ? (await loadSettings()).kanban.doneVisibleDays : null;
      await Promise.all([cancelAllDocuments(), ...inactiveRepos.map(cancelRepoTaskQueries)]);
      await Promise.all([
        ...inactiveRepos.map((repoPath) => invalidateRepoTaskQueries(queryClient, repoPath)),
        queryClient.invalidateQueries({
          queryKey: documentQueryKeys.all,
          exact: false,
          refetchType: "none",
        }),
      ]);
      if (activeRepoPath && doneVisibleDays !== null) {
        await refreshActive(activeRepoPath, {
          doneVisibleDays,
          impact: { kind: "task-list-only" },
          refreshKanban: false,
        });
        const taskData = queryClient.getQueryData<{ tasks: TaskCard[] }>(
          taskQueryKeys.repoData(activeRepoPath, doneVisibleDays),
        );
        if (!taskData) {
          throw new Error(
            `Task snapshot refresh for '${activeRepoPath}' did not populate task data.`,
          );
        }
        const retainedTaskIds = new Set(taskData.tasks.map((task) => task.id));
        await refreshSnapshotDocumentEntries(
          activeRepoPath,
          activeDocumentEntries.filter((entry) => retainedTaskIds.has(entry.taskId)),
        );
      }
    },
  };
};

const createProductionTaskViewSync = (queryClient: QueryClient): TaskViewSync =>
  createTaskViewSync({
    queryClient,
    ports: {
      loadSettings: () => host.workspaceGetSettingsSnapshot(),
      listTasks: (repoPath, doneVisibleDays) => host.tasksList(repoPath, doneVisibleDays),
      loadFreshDocument: (repoPath, taskId, section) =>
        host.taskDocumentGetFresh(repoPath, taskId, section),
    },
  });

const productionTaskViewSyncs = new WeakMap<QueryClient, TaskViewSync>();

export const getProductionTaskViewSync = (queryClient: QueryClient): TaskViewSync => {
  const existing = productionTaskViewSyncs.get(queryClient);
  if (existing) {
    return existing;
  }
  const taskViewSync = createProductionTaskViewSync(queryClient);
  productionTaskViewSyncs.set(queryClient, taskViewSync);
  return taskViewSync;
};
