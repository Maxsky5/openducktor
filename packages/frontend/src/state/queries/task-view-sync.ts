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
  /** Read the lists of every open workspace again. Other cached lists read when a view needs them. */
  refreshAfterTaskRetentionChange: (openRepoPaths: readonly string[]) => Promise<void>;
  refreshDocumentsForTasks: (repoPath: string, taskIds: string[]) => Promise<void>;
  reconcileExternalEvent: (event: ExternalTaskSyncEvent, cursor: TaskEventCursor) => Promise<void>;
  /** Read the task list of every open workspace again. One failed workspace does not stop the others. */
  reconcileStreamSnapshot: (openRepoPaths: readonly string[]) => Promise<TaskSnapshotResult>;
  /** Drop the cached task lists and documents of a workspace that closed. */
  releaseWorkspace: (repoPath: string) => Promise<void>;
};

/** A workspace that a release superseded during the snapshot appears in neither map. */
export type TaskSnapshotResult = {
  /** The task IDs of each open workspace whose task read succeeded. */
  taskIdsByRepo: ReadonlyMap<string, string[]>;
  /** The cause for each open workspace whose task read failed. The task query keeps the failure. */
  failures: ReadonlyMap<string, unknown>;
};

type CachedDocument = {
  queryKey: readonly unknown[];
  section: TaskDocumentSection;
  taskId: string;
};

/** A task list read, with the workspace epoch when the read was requested. */
type ListRequest = { repoPath: string; workspaceEpoch: number };

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
  const repoRefreshes = new Map<string, Promise<unknown>>();
  // Each release of a workspace advances its epoch and supersedes the reads requested before it.
  const workspaceEpochs = new Map<string, number>();
  const workspaceEpochOf = (repoPath: string): number => workspaceEpochs.get(repoPath) ?? 0;
  const listRequest = (repoPath: string): ListRequest => ({
    repoPath,
    workspaceEpoch: workspaceEpochOf(repoPath),
  });
  const isSuperseded = ({ repoPath, workspaceEpoch }: ListRequest): boolean =>
    workspaceEpochOf(repoPath) !== workspaceEpoch;

  const recordCardVersion = (entry: CachedDocument, card: TaskCard): void => {
    const summary =
      entry.section === "qa" ? card.documentSummary.qaReport : card.documentSummary[entry.section];
    const committedAt = summary.has ? summary.updatedAt : card.updatedAt;
    if (committedAt) recordDocumentVersion(queryClient, entry.queryKey, committedAt);
  };

  const fetchTasks = async (request: ListRequest): Promise<TaskCard[]> => {
    // A closed workspace keeps no list, also when older work for it runs late.
    if (isSuperseded(request)) throw new CancelledError();
    const { repoPath } = request;
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
  // A list that misses changes made outside the task stream also waits for a full read.
  const incompleteLists = new WeakSet<Query>();
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
    if (event.type === "updated" && event.action.type === "success")
      incompleteLists.delete(event.query);
    if (event.type === "removed" || (event.type === "updated" && event.action.type === "error"))
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
    const awaitsRead = query.state.data === undefined || incompleteLists.has(query);
    if (awaitsRead && query.state.fetchStatus !== "fetching") return;
    const pending = awaitsRead ? waitingPatches.get(query) : undefined;
    const patch: PendingPatch =
      pending ??
      (kind === "board"
        ? { kind: "board", changes: createBoardChanges() }
        : { kind: "ids", changes: createIdChanges() });
    patch.changes.merge(change);
    if (awaitsRead) {
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

  /** The cached documents of a repository, or only those of the given tasks. */
  const documentsOf = (repoPath: string, taskIds?: string[]): CachedDocument[] => {
    const taskIdSet = taskIds ? new Set(taskIds) : null;
    return cachedDocuments(queryClient, repoPath).filter(
      (entry) => !taskIdSet || taskIdSet.has(entry.taskId),
    );
  };

  const cancelDocuments = async (repoPath: string, taskIds?: string[]): Promise<void> => {
    await Promise.all(
      documentsOf(repoPath, taskIds).map((entry) =>
        queryClient.cancelQueries({ queryKey: entry.queryKey, exact: true }, { silent: true }),
      ),
    );
  };

  const cancelRepoTaskQueries = (repoPath: string): Promise<void> => {
    const filters = { queryKey: taskQueryKeys.repoDataPrefix(repoPath), exact: false };
    for (const query of queryClient.getQueryCache().findAll(filters)) {
      waitingPatches.delete(query);
    }
    return queryClient.cancelQueries(filters, { silent: true });
  };

  const removeDocuments = (repoPath: string, taskIds?: string[]): void => {
    for (const entry of documentsOf(repoPath, taskIds)) {
      queryClient.removeQueries({ queryKey: entry.queryKey, exact: true });
    }
  };

  const invalidateDocuments = async (repoPath: string, taskIds?: string[]): Promise<void> => {
    await Promise.all(
      documentsOf(repoPath, taskIds).map((entry) =>
        queryClient.invalidateQueries({
          queryKey: entry.queryKey,
          exact: true,
          refetchType: "none",
        }),
      ),
    );
  };

  const runForRepo = <Result>(
    repoPath: string,
    operation: () => Promise<Result>,
  ): Promise<Result> => {
    const previous = repoRefreshes.get(repoPath) ?? Promise.resolve();
    let current!: Promise<Result>;
    current = previous.then(operation, operation).finally(() => {
      if (repoRefreshes.get(repoPath) === current) {
        repoRefreshes.delete(repoPath);
      }
    });
    repoRefreshes.set(repoPath, current);
    return current;
  };

  /** Queue work that reads a task list. A release after this call supersedes the read. */
  const runListRead = <Result>(
    repoPath: string,
    operation: (request: ListRequest) => Promise<Result>,
  ): Promise<Result> => {
    const request = listRequest(repoPath);
    return runForRepo(repoPath, () => operation(request));
  };

  const refreshTasks = async (request: ListRequest): Promise<TaskCard[]> => {
    await cancelRepoTaskQueries(request.repoPath);
    await invalidateRepoTaskQueries(queryClient, request.repoPath);
    return fetchTasks(request);
  };

  /**
   * Replace a list that misses changes made outside the task stream, such as during a stream gap
   * or a retention change. When the read fails, the list keeps its failure until a full read.
   */
  const replaceIncompleteList = async (request: ListRequest): Promise<TaskCard[]> => {
    try {
      return await refreshTasks(request);
    } catch (error) {
      const query = queryClient
        .getQueryCache()
        .find({ queryKey: taskQueryKeys.repoData(request.repoPath), exact: true });
      // A superseded read failed because of the release. A later list is not incomplete.
      if (query && !isSuperseded(request)) incompleteLists.add(query);
      throw error;
    }
  };

  const observedDocumentsOf = (repoPath: string): CachedDocument[] =>
    cachedDocuments(queryClient, repoPath).filter(
      (entry) =>
        queryClient.getQueryCache().find({ queryKey: entry.queryKey, exact: true })?.isActive() ===
        true,
    );

  /** Read the task list and the observed documents of an open workspace after a stream gap. */
  const reloadRepo = (request: ListRequest, observedDocuments: CachedDocument[]) =>
    runForRepo(request.repoPath, async () => {
      await cancelDocuments(request.repoPath);
      await invalidateDocuments(request.repoPath);
      const tasks = await replaceIncompleteList(request);
      const taskIds = tasks.map((task) => task.id);
      const visibleTaskIds = new Set(taskIds);
      // A failed document read stays in its document query. The task IDs are current.
      await Promise.allSettled(
        observedDocuments
          .filter((entry) => visibleTaskIds.has(entry.taskId))
          .map((entry) => refreshDocuments(request.repoPath, [entry])),
      );
      return taskIds;
    });

  /** Mark the cached views of a workspace that is not open stale. Observed views read again. */
  const markRepoStale = (repoPath: string): Promise<void> =>
    runForRepo(repoPath, async () => {
      await Promise.all([cancelDocuments(repoPath), cancelRepoTaskQueries(repoPath)]);
      await Promise.all([
        invalidateRepoTaskQueries(queryClient, repoPath),
        invalidateDocuments(repoPath),
      ]);
      await queryClient.refetchQueries({
        queryKey: taskQueryKeys.repoData(repoPath),
        exact: true,
        type: "active",
      });
    });

  return {
    loadWorkspace: (repoPath, options) =>
      runListRead(repoPath, async (request) => {
        const state = queryClient.getQueryState(taskQueryKeys.repoData(repoPath));
        if (options?.forceFresh || state?.status !== "success") {
          await fetchTasks(request);
        }
      }),
    refreshManually: (repoPath) =>
      runListRead(repoPath, async (request) => {
        await refreshTasks(request);
      }),
    refreshAfterTaskRetentionChange: async (openRepoPaths) => {
      const openRepos = new Set(openRepoPaths);
      const repos = new Set<string>([
        ...openRepoPaths,
        ...cachedRepoPaths(
          queryClient.getQueryCache().findAll({ queryKey: taskQueryKeys.all, exact: false }),
        ),
      ]);
      await Promise.all(
        [...repos].map((repoPath) =>
          openRepos.has(repoPath)
            ? runListRead(repoPath, async (request) => {
                try {
                  await replaceIncompleteList(request);
                } catch {
                  // TanStack Query keeps the failure for the views of this workspace to report.
                }
              })
            : runForRepo(repoPath, async () => {
                await cancelRepoTaskQueries(repoPath);
                await invalidateRepoTaskQueries(queryClient, repoPath);
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
    reconcileExternalEvent: async (event, cursor) => {
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
    reconcileStreamSnapshot: async (openRepoPaths) => {
      waitingPatches.clear();
      // Take the request and the observed documents of each workspace before the first await.
      const openRepos = openRepoPaths.map((repoPath) => ({
        request: listRequest(repoPath),
        observedDocuments: observedDocumentsOf(repoPath),
      }));
      const taskQueries = queryClient
        .getQueryCache()
        .findAll({ queryKey: taskQueryKeys.all, exact: false });
      const documentQueries = queryClient
        .getQueryCache()
        .findAll({ queryKey: documentQueryKeys.all, exact: false });
      // A gap makes pending saves uncertain even for tasks absent from the board.
      // Reset their owners before recovery yields. Missing cards do not prove deletion.
      resetDocumentSaveOwners(documentQueries);
      const openRepoPathSet = new Set(openRepoPaths);
      const otherRepos = new Set(
        [...cachedRepoPaths(taskQueries), ...cachedRepoPaths(documentQueries)].filter(
          (repoPath) => !openRepoPathSet.has(repoPath),
        ),
      );
      const [results] = await Promise.all([
        Promise.allSettled(
          openRepos.map(({ request, observedDocuments }) => reloadRepo(request, observedDocuments)),
        ),
        ...[...otherRepos].map(markRepoStale),
      ]);
      const taskIdsByRepo = new Map<string, string[]>();
      const failures = new Map<string, unknown>();
      openRepos.forEach(({ request }, index) => {
        // A release during the snapshot superseded this workspace. Its result does not matter.
        if (isSuperseded(request)) return;
        const result = results[index]!;
        if (result.status === "fulfilled") taskIdsByRepo.set(request.repoPath, result.value);
        else failures.set(request.repoPath, result.reason);
      });
      return { taskIdsByRepo, failures };
    },
    releaseWorkspace: async (repoPath) => {
      workspaceEpochs.set(repoPath, workspaceEpochOf(repoPath) + 1);
      // Both cancel synchronously, so no read of the workspace runs after the removal below.
      const cancelled = Promise.all([cancelRepoTaskQueries(repoPath), cancelDocuments(repoPath)]);
      queryClient.removeQueries({ queryKey: taskQueryKeys.repoDataPrefix(repoPath) });
      removeDocuments(repoPath);
      await cancelled;
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

const cachedRepoPaths = (queries: Query[]): string[] =>
  queries.flatMap((query) => {
    const repoPathResult = queryKeyStringSchema.safeParse(query.queryKey[2]);
    return repoPathResult.success ? [repoPathResult.data] : [];
  });

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
