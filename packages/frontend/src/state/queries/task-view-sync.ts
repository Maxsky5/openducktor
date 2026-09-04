import type { ExternalTaskSyncEvent, SettingsSnapshot, TaskCard } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { hostClient as host } from "@/lib/host-client";
import { resolveLatestDocumentPayload } from "./document-utils";
import { documentQueryKeys, type TaskDocument, type TaskDocumentSection } from "./documents";
import { invalidateRepoTaskQueries, taskQueryKeys } from "./tasks";
import { workspaceQueryKeys } from "./workspace";

export type TaskViewSyncPorts = {
  loadSettings: () => Promise<SettingsSnapshot>;
  listTasks: (repoPath: string) => Promise<TaskCard[]>;
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
  reconcileStreamSnapshot: (activeRepoPath: string | null) => Promise<string[]>;
};

const toEventChanges = (event: ExternalTaskSyncEvent) =>
  event.kind === "external_task_created"
    ? { taskIds: [event.taskId], removedTaskIds: [] }
    : { taskIds: event.taskIds, removedTaskIds: event.removedTaskIds };

type CachedDocumentEntry = {
  queryKey: readonly unknown[];
  section: TaskDocumentSection;
  taskId: string;
};

const cachedDocumentEntries = (queryClient: QueryClient, repoPath: string): CachedDocumentEntry[] =>
  queryClient
    .getQueryCache()
    .findAll({ queryKey: documentQueryKeys.all, exact: false })
    .flatMap<CachedDocumentEntry>((query) => {
      const [scope, section, cachedRepoPath, taskId] = query.queryKey;
      const taskIdResult = z.string().safeParse(taskId);
      if (
        scope !== documentQueryKeys.all[0] ||
        cachedRepoPath !== repoPath ||
        !taskIdResult.success
      ) {
        return [];
      }
      if (section === "spec" || section === "plan") {
        return [{ queryKey: query.queryKey, section, taskId: taskIdResult.data }];
      }
      if (section === "qa-report") {
        return [{ queryKey: query.queryKey, section: "qa" as const, taskId: taskIdResult.data }];
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
  const repoRefreshes = new Map<string, Promise<void>>();

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

  const fetchTasks = async (repoPath: string): Promise<TaskCard[]> => {
    const queryKey = taskQueryKeys.repoData(repoPath);
    const taskData = await queryClient.fetchQuery({
      queryKey,
      queryFn: async () => ({ tasks: await ports.listTasks(repoPath) }),
      staleTime: 0,
    });
    return taskData.tasks;
  };

  const toTaskIdSet = (tasks: TaskCard[]): Set<string> => new Set(tasks.map((task) => task.id));

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
  ): Promise<void> => refreshDocumentEntries(repoPath, entries);

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

  const runForRepo = (repoPath: string, operation: () => Promise<void>): Promise<void> => {
    const previous = repoRefreshes.get(repoPath) ?? Promise.resolve();
    let current!: Promise<void>;
    current = previous.then(operation, operation).finally(() => {
      if (repoRefreshes.get(repoPath) === current) {
        repoRefreshes.delete(repoPath);
      }
    });
    repoRefreshes.set(repoPath, current);
    return current;
  };

  type RefreshOptions = {
    impact: LocalMutationImpact;
    refreshDocumentsFor?: string[];
    prepare?: () => Promise<void>;
  };

  const refreshActiveNow = async (
    repoPath: string,
    options: RefreshOptions,
  ): Promise<TaskCard[]> => {
    await options.prepare?.();
    await loadSettings();
    if (options.impact.kind === "remove-documents") {
      removeDocuments(repoPath, options.impact.taskIds);
    }
    await cancelRepoTaskQueries(repoPath);
    await invalidateRepoTaskQueries(queryClient, repoPath);
    const tasks = await fetchTasks(repoPath);
    if (options.impact.kind === "refresh-documents") {
      await refreshDocuments(repoPath, options.impact.taskIds);
    }
    if (options.refreshDocumentsFor) {
      const visibleTaskIds = toTaskIdSet(tasks);
      await refreshDocuments(
        repoPath,
        options.refreshDocumentsFor.filter((taskId) => visibleTaskIds.has(taskId)),
      );
    }
    return tasks;
  };

  const refreshActive = (repoPath: string, options: RefreshOptions): Promise<void> =>
    runForRepo(repoPath, async () => {
      await refreshActiveNow(repoPath, options);
    });

  return {
    loadWorkspace: async (repoPath) => {
      await loadSettings();
      const state = queryClient.getQueryState(taskQueryKeys.repoData(repoPath));
      if (state?.status !== "success") {
        await fetchTasks(repoPath);
      }
    },
    refreshManually: (repoPath) =>
      refreshActive(repoPath, {
        impact: { kind: "task-list-only" },
      }),
    refreshAfterLocalMutation: (repoPath, impact) => refreshActive(repoPath, { impact }),
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
        await runForRepo(event.repoPath, async () => {
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
      const documentQueries = queryClient
        .getQueryCache()
        .findAll({ queryKey: documentQueryKeys.all, exact: false });
      const repos = new Set<string>([
        ...(activeRepoPath ? [activeRepoPath] : []),
        ...taskQueries.flatMap((query) => {
          const repoPathResult = z.string().safeParse(query.queryKey[2]);
          return repoPathResult.success ? [repoPathResult.data] : [];
        }),
        ...documentQueries.flatMap((query) => {
          const repoPathResult = z.string().safeParse(query.queryKey[2]);
          return repoPathResult.success ? [repoPathResult.data] : [];
        }),
      ]);
      const invalidateInactiveRepo = (repoPath: string): Promise<void> =>
        runForRepo(repoPath, async () => {
          await Promise.all([cancelDocuments(repoPath), cancelRepoTaskQueries(repoPath)]);
          await Promise.all([
            invalidateRepoTaskQueries(queryClient, repoPath),
            invalidateDocuments(repoPath),
          ]);
        });
      const inactiveRefreshes: Promise<void>[] = [];
      for (const repoPath of repos) {
        if (repoPath !== activeRepoPath) {
          inactiveRefreshes.push(invalidateInactiveRepo(repoPath));
        }
      }
      if (!activeRepoPath) {
        await Promise.all(inactiveRefreshes);
        return [];
      }
      let activeTaskIds: string[] = [];
      const activeRefresh = runForRepo(activeRepoPath, async () => {
        await cancelDocuments(activeRepoPath);
        await invalidateDocuments(activeRepoPath);
        const tasks = await refreshActiveNow(activeRepoPath, {
          impact: { kind: "task-list-only" },
        });
        activeTaskIds = tasks.map((task) => task.id);
        const visibleTaskIds = toTaskIdSet(tasks);
        await refreshSnapshotDocumentEntries(
          activeRepoPath,
          activeDocumentEntries.filter((entry) => visibleTaskIds.has(entry.taskId)),
        );
      });
      await Promise.all([activeRefresh, ...inactiveRefreshes]);
      return activeTaskIds;
    },
  };
};

const createProductionTaskViewSync = (queryClient: QueryClient): TaskViewSync =>
  createTaskViewSync({
    queryClient,
    ports: {
      loadSettings: () => host.workspaceGetSettingsSnapshot(),
      listTasks: (repoPath) => host.tasksList(repoPath),
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
