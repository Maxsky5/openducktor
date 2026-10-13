import type {
  ExternalTaskSyncEvent,
  TaskCard,
  TaskDocumentChange,
  TaskEventCursor,
} from "@openducktor/contracts";
import { CancelledError, type Query, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { hostClient as host } from "@/lib/host-client";
import {
  documentQueryKeys,
  fetchFreshTaskDocumentFromQuery,
  resetDocumentSaveOwners,
  recordDocumentVersion,
  recordDocumentCommit,
  type TaskDocumentReader,
  type TaskDocumentSection,
} from "./documents";
import { type RepoTaskData, invalidateRepoTaskQueries, taskQueryKeys } from "./tasks";
import {
  createBoardChanges,
  createIdChanges,
  type TaskQueryChange,
  type TaskQueryChanges,
} from "./task-query-changes";

const queryKeyStringSchema = z.string();

export type TaskViewSyncPorts = {
  listTasks: (repoPath: string) => Promise<TaskCard[]>;
  loadFreshDocument: TaskDocumentReader;
};

export type TaskViewSync = {
  loadWorkspace: (repoPath: string, options?: { forceFresh?: boolean }) => Promise<void>;
  refreshManually: (repoPath: string) => Promise<void>;
  refreshAfterTaskRetentionChange: (activeRepoPath: string | null) => Promise<void>;
  refreshDocumentsForTasks: (repoPath: string, taskIds: string[]) => Promise<void>;
  reconcileExternalEvent: (
    event: ExternalTaskSyncEvent,
    activeRepoPath: string | null,
    cursor: TaskEventCursor,
  ) => Promise<void>;
  reconcileStreamSnapshot: (activeRepoPath: string | null) => Promise<string[]>;
};

type CachedDocument = {
  queryKey: readonly unknown[];
  section: TaskDocumentSection;
  taskId: string;
};

type PendingPatch =
  | { kind: "board"; changes: TaskQueryChanges<TaskCard[]> }
  | { kind: "ids"; changes: TaskQueryChanges<string[]> };

export const createTaskViewSync = ({
  queryClient,
  ports,
}: {
  queryClient: QueryClient;
  ports: TaskViewSyncPorts;
}): TaskViewSync => {
  const repoRefreshes = new Map<string, Promise<void>>();

  const recordCardVersion = (entry: CachedDocument, card: TaskCard): void => {
    const summary =
      entry.section === "qa" ? card.documentSummary.qaReport : card.documentSummary[entry.section];
    const committedAt = summary.has ? summary.updatedAt : card.updatedAt;
    if (committedAt) recordDocumentVersion(queryClient, entry.queryKey, committedAt);
  };

  const fetchTasks = async (repoPath: string): Promise<TaskCard[]> => {
    const queryKey = taskQueryKeys.repoData(repoPath);
    const taskData = await queryClient.fetchQuery({
      queryKey,
      queryFn: async () => ({ tasks: await ports.listTasks(repoPath) }),
      staleTime: 0,
    });
    const cardById = new Map(taskData.tasks.map((card) => [card.id, card]));
    for (const entry of cachedDocuments(queryClient, repoPath)) {
      const card = cardById.get(entry.taskId);
      if (card) recordCardVersion(entry, card);
    }
    return taskData.tasks;
  };

  // Wait for the first full board read before applying events to it.
  const waitingPatches = new Map<Query, PendingPatch>();
  const applyPatch = (query: Query, patch: PendingPatch): void => {
    if (queryClient.getQueryCache().find({ queryKey: query.queryKey, exact: true }) !== query)
      return;
    if (patch.kind === "board") {
      queryClient.setQueryData<RepoTaskData>(query.queryKey, (data) =>
        data === undefined ? undefined : { tasks: patch.changes.apply(data.tasks) },
      );
    } else {
      queryClient.setQueryData<string[]>(query.queryKey, (data) =>
        data === undefined ? undefined : patch.changes.apply(data),
      );
    }
  };
  queryClient.getQueryCache().subscribe((event) => {
    if (
      event.type === "removed" ||
      (event.type === "updated" && event.query.state.status === "error")
    )
      waitingPatches.delete(event.query);
    if (
      event.type !== "updated" ||
      event.query.state.status !== "success" ||
      event.query.state.fetchStatus !== "idle"
    )
      return;
    const patch = waitingPatches.get(event.query);
    if (!patch) return;
    waitingPatches.delete(event.query);
    applyPatch(event.query, patch);
  });

  const patchQuery = async (
    queryKey: readonly unknown[],
    kind: PendingPatch["kind"],
    change: TaskQueryChange,
  ): Promise<void> => {
    const query = queryClient.getQueryCache().find({ queryKey, exact: true });
    if (!query) return;
    if (query.state.data === undefined && query.state.fetchStatus !== "fetching") return;
    const pending = query.state.data === undefined ? waitingPatches.get(query) : undefined;
    const patch: PendingPatch =
      pending ??
      (kind === "board"
        ? { kind: "board", changes: createBoardChanges() }
        : { kind: "ids", changes: createIdChanges() });
    patch.changes.merge(change);
    if (query.state.data === undefined) {
      waitingPatches.set(query, patch);
      return;
    }
    await queryClient.cancelQueries({ queryKey, exact: true }, { silent: true });
    applyPatch(query, patch);
  };

  const refreshDocuments = async (repoPath: string, entries: CachedDocument[]): Promise<void> => {
    await Promise.all(
      entries.map((entry) =>
        fetchFreshTaskDocumentFromQuery(
          queryClient,
          repoPath,
          entry.taskId,
          entry.section,
          ports.loadFreshDocument,
        ),
      ),
    );
  };

  const updateDocuments = async (
    repoPath: string,
    cards: TaskCard[],
    removed = new Set<string>(),
    eventTime = Date.now(),
    previousCards: TaskCard[] = [],
    commit?: { cursor: TaskEventCursor; documentChanges: TaskDocumentChange[] },
  ): Promise<void> => {
    const cardById = new Map(cards.map((card) => [card.id, card]));
    await Promise.all(
      cachedDocuments(queryClient, repoPath).map(async (entry) => {
        const card = cardById.get(entry.taskId);
        if (!card || removed.has(entry.taskId)) return;
        const query = queryClient.getQueryCache().find({ queryKey: entry.queryKey, exact: true });
        const summary =
          entry.section === "qa"
            ? card.documentSummary.qaReport
            : card.documentSummary[entry.section];
        const previousCard = previousCards.find((card) => card.id === entry.taskId);
        const previousSummary =
          entry.section === "qa"
            ? previousCard?.documentSummary.qaReport
            : previousCard?.documentSummary[entry.section];
        const written =
          commit?.documentChanges.some(
            (change) => change.taskId === entry.taskId && change.sections.includes(entry.section),
          ) === true;
        const changed =
          written ||
          (previousSummary !== undefined &&
            (previousSummary.has !== summary.has ||
              previousSummary.updatedAt !== summary.updatedAt));
        if (commit && !recordDocumentCommit(queryClient, entry.queryKey, commit.cursor, changed))
          return;
        let current = queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
          entry.queryKey,
        );
        if (current?.updatedAt && Date.parse(current.updatedAt) > eventTime) return;
        recordCardVersion(entry, card);
        if (!summary.has) {
          if (current === undefined || current.markdown !== "" || current.updatedAt !== null) {
            queryClient.setQueryData(entry.queryKey, { markdown: "", updatedAt: null });
          }
          return;
        }
        if (current === undefined) {
          if (
            !written &&
            previousSummary?.has === summary.has &&
            previousSummary.updatedAt === summary.updatedAt
          ) {
            return;
          }
          if (!previousCard && query?.state.fetchStatus === "fetching") {
            // Without a board baseline, let the first read establish its section version.
            let pendingRead = query.promise;
            while (pendingRead) {
              try {
                await pendingRead;
                break;
              } catch (error) {
                if (
                  queryClient.getQueryCache().find({ queryKey: entry.queryKey, exact: true }) !==
                  query
                )
                  return;
                if (!(error instanceof CancelledError)) throw error;
                // Follow an existing reload without starting a request or reusing the cancelled one.
                const replacement = query.promise;
                if (replacement && replacement !== pendingRead) {
                  pendingRead = replacement;
                  continue;
                }
                if (query.state.data === undefined) throw error;
                break;
              }
            }
            if (
              queryClient.getQueryCache().find({ queryKey: entry.queryKey, exact: true }) !== query
            )
              return;
            current = queryClient.getQueryData(entry.queryKey);
          }
        }
        const cachedAt = current?.updatedAt ?? null;
        if (cachedAt !== null && Date.parse(cachedAt) > eventTime) return;
        const changedAt = summary.updatedAt ?? null;
        if (
          !written &&
          (cachedAt === changedAt ||
            (cachedAt !== null &&
              (changedAt === null || Date.parse(changedAt) <= Date.parse(cachedAt))))
        )
          return;
        await queryClient.cancelQueries(
          { queryKey: entry.queryKey, exact: true },
          { silent: true, revert: false },
        );
        if (queryClient.getQueryCache().find({ queryKey: entry.queryKey, exact: true }) !== query)
          return;
        await queryClient.invalidateQueries({
          queryKey: entry.queryKey,
          exact: true,
          refetchType: "none",
        });
        if (query?.isActive()) await refreshDocuments(repoPath, [entry]);
      }),
    );
  };

  const cancelDocuments = async (repoPath: string, taskIds?: string[]): Promise<void> => {
    const taskIdSet = taskIds ? new Set(taskIds) : null;
    const cancellations: Promise<void>[] = [];
    for (const entry of cachedDocuments(queryClient, repoPath)) {
      if (!taskIdSet || taskIdSet.has(entry.taskId)) {
        cancellations.push(
          queryClient.cancelQueries({ queryKey: entry.queryKey, exact: true }, { silent: true }),
        );
      }
    }
    await Promise.all(cancellations);
  };

  const cancelRepoTaskQueries = (repoPath: string): Promise<void> => {
    const filters = { queryKey: taskQueryKeys.repoDataPrefix(repoPath), exact: false };
    for (const query of queryClient.getQueryCache().findAll(filters)) {
      waitingPatches.delete(query);
    }
    return queryClient.cancelQueries(filters, { silent: true });
  };

  const removeDocuments = (repoPath: string, taskIds: string[]): void => {
    const taskIdSet = new Set(taskIds);
    for (const entry of cachedDocuments(queryClient, repoPath)) {
      if (taskIdSet.has(entry.taskId)) {
        queryClient.removeQueries({ queryKey: entry.queryKey, exact: true });
      }
    }
  };

  const invalidateDocuments = async (repoPath: string, taskIds?: string[]): Promise<void> => {
    const taskIdSet = taskIds ? new Set(taskIds) : null;
    const invalidations: Promise<void>[] = [];
    for (const entry of cachedDocuments(queryClient, repoPath)) {
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

  const refreshActiveNow = async (repoPath: string): Promise<TaskCard[]> => {
    await cancelRepoTaskQueries(repoPath);
    await invalidateRepoTaskQueries(queryClient, repoPath);
    return fetchTasks(repoPath);
  };

  return {
    loadWorkspace: (repoPath, options) =>
      runForRepo(repoPath, async () => {
        const state = queryClient.getQueryState(taskQueryKeys.repoData(repoPath));
        if (options?.forceFresh || state?.status !== "success") {
          await fetchTasks(repoPath);
        }
      }),
    refreshManually: (repoPath) =>
      runForRepo(repoPath, async () => {
        await refreshActiveNow(repoPath);
      }),
    refreshAfterTaskRetentionChange: async (activeRepoPath) => {
      const taskQueries = queryClient
        .getQueryCache()
        .findAll({ queryKey: taskQueryKeys.all, exact: false });
      const repos = new Set<string>([
        ...(activeRepoPath ? [activeRepoPath] : []),
        ...taskQueries.flatMap((query) => {
          const repoPathResult = queryKeyStringSchema.safeParse(query.queryKey[2]);
          return repoPathResult.success ? [repoPathResult.data] : [];
        }),
      ]);
      await Promise.all(
        [...repos].map((repoPath) =>
          runForRepo(repoPath, async () => {
            await cancelRepoTaskQueries(repoPath);
            await invalidateRepoTaskQueries(queryClient, repoPath);
            if (repoPath === activeRepoPath) {
              try {
                await fetchTasks(repoPath);
              } catch {
                // TanStack Query keeps the failure for the task-loading error path to report.
              }
            }
          }),
        ),
      );
    },
    refreshDocumentsForTasks: (repoPath, taskIds) =>
      runForRepo(repoPath, async () => {
        const data = queryClient.getQueryData<RepoTaskData>(taskQueryKeys.repoData(repoPath));
        const taskIdSet = new Set(taskIds);
        await updateDocuments(repoPath, data?.tasks.filter((card) => taskIdSet.has(card.id)) ?? []);
      }),
    reconcileExternalEvent: async (event, _activeRepoPath, cursor) => {
      if (!event.boardChanges) return;
      await runForRepo(event.repoPath, async () => {
        const { cards, doneVisibleDays } = event.boardChanges!;
        const previousCards =
          queryClient.getQueryData<RepoTaskData>(taskQueryKeys.repoData(event.repoPath))?.tasks ??
          [];
        const { taskIds, removedTaskIds } = toEventChanges(event);
        const removed = new Set(removedTaskIds);
        const change: TaskQueryChange = {
          cards,
          taskIds,
          removedTaskIds,
          cutoff:
            doneVisibleDays === 0
              ? Infinity
              : Date.parse(event.emittedAt) - doneVisibleDays * 86400000,
        };
        await patchQuery(taskQueryKeys.repoData(event.repoPath), "board", change);
        await patchQuery(taskQueryKeys.ids(event.repoPath), "ids", change);
        await cancelDocuments(event.repoPath, removedTaskIds);
        removeDocuments(event.repoPath, removedTaskIds);
        await updateDocuments(
          event.repoPath,
          cards,
          removed,
          Date.parse(event.emittedAt),
          previousCards,
          { cursor, documentChanges: event.boardChanges!.documentChanges },
        );
      });
    },
    reconcileStreamSnapshot: async (activeRepoPath) => {
      waitingPatches.clear();
      const activeDocuments = activeRepoPath
        ? cachedDocuments(queryClient, activeRepoPath).filter(
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
      // A gap makes pending saves uncertain even for tasks absent from the board.
      // Reset their owners before recovery yields. Missing cards do not prove deletion.
      resetDocumentSaveOwners(documentQueries);
      const repos = new Set<string>([
        ...(activeRepoPath ? [activeRepoPath] : []),
        ...taskQueries.flatMap((query) => {
          const repoPathResult = queryKeyStringSchema.safeParse(query.queryKey[2]);
          return repoPathResult.success ? [repoPathResult.data] : [];
        }),
        ...documentQueries.flatMap((query) => {
          const repoPathResult = queryKeyStringSchema.safeParse(query.queryKey[2]);
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
          // Observed lists need recovery even when their workspace is inactive.
          await queryClient.refetchQueries({
            queryKey: taskQueryKeys.repoData(repoPath),
            exact: true,
            type: "active",
          });
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
        const tasks = await refreshActiveNow(activeRepoPath);
        activeTaskIds = tasks.map((task) => task.id);
        const visibleTaskIds = new Set(activeTaskIds);
        await refreshDocuments(
          activeRepoPath,
          activeDocuments.filter((entry) => visibleTaskIds.has(entry.taskId)),
        );
      });
      await Promise.all([activeRefresh, ...inactiveRefreshes]);
      return activeTaskIds;
    },
  };
};

const productionTaskViewSyncs = new WeakMap<QueryClient, TaskViewSync>();

export const getProductionTaskViewSync = (queryClient: QueryClient): TaskViewSync => {
  const existing = productionTaskViewSyncs.get(queryClient);
  if (existing) {
    return existing;
  }
  const taskViewSync = createTaskViewSync({
    queryClient,
    ports: {
      listTasks: (repoPath) => host.tasksList(repoPath),
      loadFreshDocument: (repoPath, taskId, section) =>
        host.taskDocumentGet(repoPath, taskId, section),
    },
  });
  productionTaskViewSyncs.set(queryClient, taskViewSync);
  return taskViewSync;
};

const toEventChanges = (event: ExternalTaskSyncEvent) =>
  event.kind === "external_task_created"
    ? { taskIds: [event.taskId], removedTaskIds: [] }
    : { taskIds: event.taskIds, removedTaskIds: event.removedTaskIds };

const cachedDocuments = (queryClient: QueryClient, repoPath: string): CachedDocument[] =>
  queryClient
    .getQueryCache()
    .findAll({ queryKey: documentQueryKeys.all, exact: false })
    .flatMap<CachedDocument>((query) => {
      const [scope, section, cachedRepoPath, taskId] = query.queryKey;
      const taskIdResult = queryKeyStringSchema.safeParse(taskId);
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
